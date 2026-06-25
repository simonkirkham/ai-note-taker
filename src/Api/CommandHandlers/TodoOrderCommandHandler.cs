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
        CommandInstrumentation.RunAsync(metrics, logger, nameof(ReorderTodos), "TodoOrdering", async () =>
        {
            var streamId = TodoOrdering.StreamId(cmd.WorkspaceId);
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = RebuildAggregate(history).Handle(cmd);
            var envelopes = EventEnvelopeFactory.CreateEnvelopes(streamId, newEvents, currentUser.UserId, currentWorkspace.WorkspaceId);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            return (long)(history.Count + envelopes.Count);
        });

    static TodoOrdering RebuildAggregate(IReadOnlyList<EventEnvelope> history)
    {
        var aggregate = new TodoOrdering();
        foreach (var e in history)
            aggregate.Apply(EventDeserializer.Deserialize(e));
        return aggregate;
    }
}
