using EventStore.Projections;
using Microsoft.Extensions.Logging;

namespace Api.Consistency;

// Bounded-poll read-your-writes gate. Parses `If-Consistent-With: <stream>@<version>`, then
// polls the processed-position store until that stream's applied sequence reaches the version
// (Fresh) or the cap elapses (Stale). A missing/malformed token is a no-op (Proceed) — never
// throws, so a client that sends nothing keeps the pre-RYW behaviour.
//
// Poll interval + cap are injectable (and the delay is a func) so unit tests advance virtual
// time instead of sleeping the real ~2s bound.
public sealed class ConsistencyGate(
    IProcessedPositionStore positions,
    TimeSpan pollInterval,
    TimeSpan cap,
    Func<TimeSpan, CancellationToken, Task>? delay = null,
    ILogger<ConsistencyGate>? logger = null) : IConsistencyGate
{
    private readonly Func<TimeSpan, CancellationToken, Task> _delay = delay ?? Task.Delay;

    // Production defaults: 50ms poll, 2000ms cap (Postgres WAIT FOR LSN ... TIMEOUT '2s').
    public ConsistencyGate(IProcessedPositionStore positions, ILogger<ConsistencyGate>? logger = null)
        : this(positions, TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(2000), delay: null, logger: logger) { }

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
