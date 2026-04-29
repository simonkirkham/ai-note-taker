namespace EventStore;

public sealed class ConcurrencyException(string streamId, long expected, long actual)
    : Exception($"Stream '{streamId}': expected version {expected} but was {actual}.")
{
    public string StreamId { get; } = streamId;
    public long ExpectedVersion { get; } = expected;
    public long ActualVersion { get; } = actual;
}
