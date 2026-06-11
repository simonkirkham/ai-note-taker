using Domain;
using Domain.Workspaces;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

public sealed class WorkspaceCommandHandler(
    IEventStore store,
    INoteCardListStore noteCardListStore,
    ICurrentUser currentUser,
    IDomainMetrics metrics,
    ILogger<WorkspaceCommandHandler> logger) : IWorkspaceCommandHandler
{
    public Task<WorkspaceId> HandleAsync(CreateWorkspace cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CreateWorkspace), "Workspace", async () =>
        {
            var streamId = cmd.WorkspaceId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = Rebuild(history).Handle(cmd);
            await PersistAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
            return cmd.WorkspaceId;
        });

    public Task HandleAsync(RenameWorkspace cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(RenameWorkspace), "Workspace", async () =>
        {
            var streamId = cmd.WorkspaceId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new WorkspaceNotFoundException(cmd.WorkspaceId);
            var newEvents = Rebuild(history).Handle(cmd);
            if (newEvents.Count == 0) return;
            await PersistAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
        });

    public Task HandleAsync(DeleteWorkspace cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteWorkspace), "Workspace", async () =>
        {
            var streamId = cmd.WorkspaceId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0 && !cmd.WorkspaceId.IsDefault)
                throw new WorkspaceNotFoundException(cmd.WorkspaceId);
            if (await HasActiveNotesAsync(cmd.WorkspaceId, ct).ConfigureAwait(false))
                throw new WorkspaceNotEmptyException(cmd.WorkspaceId);
            var newEvents = Rebuild(history).Handle(cmd);
            var envelopes = ToEnvelopes(streamId, newEvents);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        });

    private async Task PersistAsync(string streamId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, CancellationToken ct)
    {
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
    }

    // A workspace is "empty" when it holds no active (non-deleted) note for the caller.
    // Historical notes with no workspace resolve to the default workspace (null→default).
    private async Task<bool> HasActiveNotesAsync(WorkspaceId workspaceId, CancellationToken ct)
    {
        var cards = await noteCardListStore.QueryAllAsync(ct).ConfigureAwait(false);
        return cards.Any(c => !c.Deleted
            && c.UserId == currentUser.UserId
            && (string.IsNullOrEmpty(c.WorkspaceId) ? WorkspaceId.DefaultValue : c.WorkspaceId) == workspaceId.Value);
    }

    private static Workspace Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var workspace = new Workspace();
        foreach (var e in history)
            workspace.Apply(EventDeserializer.Deserialize(e));
        return workspace;
    }

    private List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, currentUser.UserId);
}
