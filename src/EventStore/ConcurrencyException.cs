namespace EventStore;

public sealed class ConcurrencyException(string streamId, long expected, long actual, string? reason = null)
    : Exception($"Stream '{streamId}': expected version {expected} but was {actual}{(reason is null ? "" : $" ({reason})")}.")
{
    public string StreamId { get; } = streamId;
    public long ExpectedVersion { get; } = expected;
    public long ActualVersion { get; } = actual;
    // The DynamoDB TransactWriteItems cancellation reason that produced this conflict —
    // "ConditionalCheckFailed" (version-guard lost) or "TransactionConflict" (concurrent
    // transaction on the same item, BUG-28). Surfaced so logs/metrics can tell them apart.
    public string? Reason { get; } = reason;
}
