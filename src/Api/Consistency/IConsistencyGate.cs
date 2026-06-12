namespace Api.Consistency;

// Read-your-writes gate (RYW-1). A read endpoint passes the client's `If-Consistent-With`
// token; the gate waits (bounded) on the processed-position store until the projector has
// applied that stream's write, so the read sees it. This is the application-layer equivalent
// of Cosmos `SessionToken` / Mongo `afterClusterTime` / Postgres `WAIT FOR LSN`.
public interface IConsistencyGate
{
    Task<ConsistencyResult> WaitAsync(string? ifConsistentWith, CancellationToken ct = default);
}

public enum ConsistencyOutcome
{
    // No usable token (absent or malformed) — the read proceeds without waiting.
    Proceed,
    // The projection reached the requested version within the bound.
    Fresh,
    // The bound elapsed before the projection caught up — serve current data + X-Consistency: stale.
    Stale
}

public readonly record struct ConsistencyResult(ConsistencyOutcome Outcome)
{
    public bool IsStale => Outcome == ConsistencyOutcome.Stale;

    public static readonly ConsistencyResult Proceed = new(ConsistencyOutcome.Proceed);
    public static readonly ConsistencyResult Fresh = new(ConsistencyOutcome.Fresh);
    public static readonly ConsistencyResult Stale = new(ConsistencyOutcome.Stale);
}
