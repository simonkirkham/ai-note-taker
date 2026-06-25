namespace Api.CommandHandlers;

// Thrown when a command's bounded append-retry budget is exhausted by persistent optimistic-
// concurrency conflicts — concurrent writers to the same stream (e.g. a space-separated multi-tag
// add that fans into two POSTs on one note stream). Deliberately distinct from the raw
// EventStore.ConcurrencyException (which maps to 409): a 409 is ALSO the duplicate/no-op signal the
// client treats as success, so surfacing exhausted contention as 409 would silently DROP the write
// (BUG-27). This maps to a retriable 503 instead, so the client retries until the write lands.
public sealed class WriteContentionException(string streamId, Exception inner)
    : Exception($"Write contention on stream '{streamId}': append retries exhausted.", inner)
{
    public string StreamId { get; } = streamId;
}
