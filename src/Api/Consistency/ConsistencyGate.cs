using EventStore.Projections;
using Microsoft.Extensions.Logging;

namespace Api.Consistency;

// Bounded-poll read-your-writes gate. Parses `If-Consistent-With: <stream>@<version>`, then
// polls the processed-position store until that stream's applied sequence reaches the version
// (Fresh) or the cap elapses (Stale). A missing/malformed token is a no-op (Proceed) — never
// throws, so a client that sends nothing keeps the pre-RYW behaviour.
//
// Poll interval + cap are injectable (and the delay is a func) so unit tests advance virtual
// time instead of sleeping the real ~8s bound.
public sealed class ConsistencyGate(
    IProcessedPositionStore positions,
    TimeSpan pollInterval,
    TimeSpan cap,
    Func<TimeSpan, CancellationToken, Task>? delay = null,
    ILogger<ConsistencyGate>? logger = null) : IConsistencyGate
{
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;

    // Production defaults: 50ms poll, 8000ms cap.
    public static readonly TimeSpan DefaultPollInterval = TimeSpan.FromMilliseconds(50);

    // BUG-31: raised from 2000ms. The stream-triggered projector has no SnapStart/keep-warm, so
    // after an idle gap its first invocation cold-starts ~7s — longer than the old 2s cap, so a
    // fresh read gave up (Stale/Absent) before a cold projector caught up and the note looked
    // missing/broken (11 gate timeouts/14d in prod, at morning low-traffic hours). An 8s cap lets
    // the reader tolerate the cold start: a one-off slow-but-correct read after idle. The cap only
    // delays a read when the projector is actually behind — a warm projector still returns
    // immediately on the first poll. Keeping the projector warm to make cold reads fast (instead of
    // slow) is the deferred durable alternative: TI-52.
    public static readonly TimeSpan DefaultCap = TimeSpan.FromMilliseconds(8000);

    public ConsistencyGate(IProcessedPositionStore positions, ILogger<ConsistencyGate>? logger = null)
        : this(positions, DefaultPollInterval, DefaultCap, delay: null, logger: logger) { }

    public async Task<ConsistencyResult> WaitAsync(string? ifConsistentWith, CancellationToken ct = default)
    {
        if (!TryParse(ifConsistentWith, out var stream, out var version))
            return ConsistencyResult.Proceed;

        var elapsed = TimeSpan.Zero;
        while (true)
        {
            var lastSeq = await positions.GetLastSeqAsync(stream, ct).ConfigureAwait(false);
            if (lastSeq >= version)
            {
                // Slow-but-fresh: the projector caught up only after a wait. Logged so a near-cap
                // catch-up (the precursor to a Stale flake) is visible before it tips over.
                if (elapsed > TimeSpan.Zero)
                    logger?.LogInformation(
                        "RYW gate fresh {Stream} reqVersion={Version} lastSeq={LastSeq} waitMs={WaitMs}",
                        stream, version, lastSeq, elapsed.TotalMilliseconds);
                return ConsistencyResult.Fresh;
            }

            if (elapsed >= cap)
            {
                // STALE: the projector did not reach the requested version within the cap. {LastSeq}
                // vs {Version} is the key diagnostic — lastSeq < version means either the projector is
                // behind (lastSeq climbing toward version) OR the requested version was never appended
                // (the write didn't land — lastSeq is at head but head < version forever). Correlate
                // {Stream}/{Version} with the InstrumentedEventStore "Events appended" log to tell which.
                logger?.LogWarning(
                    "RYW gate STALE {Stream} reqVersion={Version} lastSeq={LastSeq} gap={Gap} elapsedMs={Elapsed}",
                    stream, version, lastSeq, version - lastSeq, elapsed.TotalMilliseconds);
                return ConsistencyResult.Stale;
            }

            await _delay(pollInterval, ct).ConfigureAwait(false);
            elapsed += pollInterval;
        }
    }

    public async Task<T?> WaitForPresenceAsync<T>(Func<CancellationToken, Task<T?>> read, string label = "", CancellationToken ct = default)
        where T : class
    {
        var elapsed = TimeSpan.Zero;
        while (true)
        {
            var value = await read(ct).ConfigureAwait(false);
            if (value is not null)
            {
                // Slow-but-present: the lagging projection row only appeared after a wait. Logged so a
                // near-cap appearance (the precursor to a spurious Absent → 404) is visible before it tips.
                // {Label} ties the line to the entity (the read func is opaque, so the caller supplies it).
                if (elapsed > TimeSpan.Zero)
                    logger?.LogInformation(
                        "RYW presence gate present {Label} waitMs={WaitMs}", label, elapsed.TotalMilliseconds);
                return value;
            }

            if (elapsed >= cap)
            {
                // ABSENT: the row never materialised within the cap. The caller treats null as the
                // entity not existing (e.g. a 404) — same outcome the old per-handler Task.Delay loop
                // produced, now with the gate's interval/cap and this diagnostic.
                logger?.LogWarning(
                    "RYW presence gate ABSENT {Label} elapsedMs={Elapsed}", label, elapsed.TotalMilliseconds);
                return null;
            }

            await _delay(pollInterval, ct).ConfigureAwait(false);
            elapsed += pollInterval;
        }
    }

    // "<stream>@<version>" — split on the LAST '@' so a stream id containing '@' is tolerated;
    // the version is the trailing long. Anything that does not parse is treated as no token.
    private static bool TryParse(string? token, out string stream, out long version)
    {
        stream = "";
        version = 0;
        if (string.IsNullOrWhiteSpace(token)) return false;

        var at = token.LastIndexOf('@');
        if (at <= 0 || at == token.Length - 1) return false;

        if (!long.TryParse(token[(at + 1)..], out version)) return false;
        stream = token[..at];
        return true;
    }
}
