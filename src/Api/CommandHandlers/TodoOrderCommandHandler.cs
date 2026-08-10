using Domain;
using Domain.Todos;
using EventStore;
using Api.Auth;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

// Append-only like TodoCommandHandler: the home To Do list read model is fully async since RYW,
// so the projector (sync decorator in-process, the Projector Lambda in prod) is the sole writer of
// the per-item Position. ReorderTodos appends a full-order snapshot to the per-workspace ordering
// stream and surfaces the new stream version as the write token; the read side waits on
// proj-position before answering.
public sealed class TodoOrderCommandHandler(
    IEventStore store,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<TodoOrderCommandHandler> logger) : ITodoOrderCommandHandler
{
    public Task<long> HandleAsync(ReorderTodos cmd, CancellationToken ct = default) =>
        AppendAsync(nameof(ReorderTodos), cmd.WorkspaceId, cmd, ct);

    public Task<long> HandleAsync(SetTodayLine cmd, CancellationToken ct = default) =>
        AppendAsync(nameof(SetTodayLine), cmd.WorkspaceId, cmd, ct);

    private const int MaxAppendAttempts = 6;
    private static readonly TimeSpan AppendRetryBaseDelay = TimeSpan.FromMilliseconds(20);

    private Task<long> AppendAsync(string commandName, string workspaceId, TodoOrderingCommand cmd, CancellationToken ct) =>
        CommandInstrumentation.RunAsync(metrics, logger, commandName, "TodoOrdering", async () =>
        {
            var streamId = TodoOrdering.StreamId(workspaceId);
            // Read → rebuild → handle → append is retried as a unit, exactly as NoteCommandHandler
            // does. This stream needs it MORE than any other, not less: it is a STABLE-ID stream
            // (todo-order#{workspaceId}), so every ordering write in the workspace contends on one
            // partition — and 50-B's "Move to Later" deliberately issues a ReorderTodos and a
            // SetTodayLine in the same tick, so the pair races itself on the primary path. Without
            // this loop the loser's raw ConcurrencyException became a 409, which the client treats
            // as a duplicate/no-op and silently drops (BUG-27's class).
            for (var attempt = 1; ; attempt++)
            {
                var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
                var newEvents = RebuildAggregate(history).Handle(cmd);
                var envelopes = EventEnvelopeFactory.CreateEnvelopes(streamId, newEvents, currentUser.UserId, currentWorkspace.WorkspaceId);
                try
                {
                    await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
                }
                catch (ConcurrencyException) when (attempt < MaxAppendAttempts)
                {
                    await DelayBeforeRetryAsync(attempt, ct).ConfigureAwait(false);
                    continue;
                }
                catch (ConcurrencyException ex)
                {
                    // Retry budget exhausted: surface as a retriable 503, never the raw
                    // ConcurrencyException (→ 409, which the client swallows as a no-op).
                    throw new WriteContentionException(streamId, ex);
                }
                return (long)(history.Count + envelopes.Count);
            }
        });

    private static Task DelayBeforeRetryAsync(int attempt, CancellationToken ct)
    {
        var backoff = AppendRetryBaseDelay.TotalMilliseconds * Math.Pow(2, attempt - 1);
        var jitter = Random.Shared.NextDouble() * backoff * 0.2;
        return Task.Delay(TimeSpan.FromMilliseconds(backoff + jitter), ct);
    }

    static TodoOrdering RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new TodoOrdering();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }
}
