using Domain;
using Domain.Folders;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;
using Api.Projections;
using Api.Utilities;

namespace Api.CommandHandlers;

public sealed class FolderCommandHandler(
    IEventStore store,
    IFolderTreeStore folderTreeStore,
    INoteCardListStore noteCardListStore,
    INoteCommandHandler noteCommandHandler,
    IProjectionUpdater projectionUpdater,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<FolderCommandHandler> logger) : IFolderCommandHandler
{
    public Task<FolderId> HandleAsync(CreateFolder cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CreateFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = RebuildFolder(history).Handle(cmd);
            await PersistFolderAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
            return cmd.FolderId;
        });

    public Task HandleAsync(RenameFolder cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(RenameFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new FolderNotFoundException(cmd.FolderId);
            var newEvents = RebuildFolder(history).Handle(cmd);
            if (newEvents.Count == 0) return;
            await PersistFolderAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
        });

    public Task HandleAsync(DeleteFolder cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new InvalidOperationException("Folder does not exist.");

            var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
            var subtreeIds = GetSubtreeIds(cmd.FolderId, allFolders);

            // Unfile notes in descendants + root folder (order doesn't matter for unfiling)
            foreach (var folderId in subtreeIds.Concat([cmd.FolderId]))
                await UnfileNotesInFolderAsync(folderId, ct).ConfigureAwait(false);

            // Delete descendant folders bottom-up (subtreeIds already in bottom-up order)
            foreach (var folderId in subtreeIds)
                await DeleteOneFolderAsync(folderId, ct).ConfigureAwait(false);

            // Delete the target folder
            var newEvents = RebuildFolder(history).Handle(cmd);
            var envelopes = ToEnvelopes(streamId, newEvents);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            await folderTreeStore.DeleteAsync(cmd.FolderId, ct).ConfigureAwait(false);
        });

    public Task HandleAsync(MoveFolder cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(MoveFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new InvalidOperationException("Folder does not exist.");

            if (cmd.NewParentFolderId.HasValue)
            {
                var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
                var subtreeIds = GetSubtreeIds(cmd.FolderId, allFolders);
                var subtreeSet = new HashSet<FolderId>(subtreeIds) { cmd.FolderId };
                if (subtreeSet.Contains(cmd.NewParentFolderId.Value))
                    throw new CycleDetectedException("Cannot move a folder into itself or one of its descendants.");
            }

            var newEvents = RebuildFolder(history).Handle(cmd);
            await PersistFolderAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
        });

    private async Task UnfileNotesInFolderAsync(FolderId folderId, CancellationToken ct)
    {
        var allCards = await noteCardListStore.QueryAllAsync(ct).ConfigureAwait(false);
        var notesInFolder = allCards.Where(c => c.FolderId == folderId && !c.Deleted && c.UserId == currentUser.UserId).ToList();
        foreach (var card in notesInFolder)
            await noteCommandHandler.HandleAsync(new UnfileNote(card.NoteId), ct).ConfigureAwait(false);
    }

    private async Task DeleteOneFolderAsync(FolderId folderId, CancellationToken ct)
    {
        var streamId = folderId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) return;
        var newEvents = RebuildFolder(history).Handle(new DeleteFolder(folderId));
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        await folderTreeStore.DeleteAsync(folderId, ct).ConfigureAwait(false);
    }

    private async Task PersistFolderAsync(string streamId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, CancellationToken ct)
    {
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        await projectionUpdater.ApplyFolderEventsAsync(envelopes, ct).ConfigureAwait(false);
    }

    private static IReadOnlyList<FolderId> GetSubtreeIds(FolderId rootId, IReadOnlyList<FolderTreeView> allFolders)
    {
        var result = new List<FolderId>();
        var queue = new Queue<FolderId>();
        queue.Enqueue(rootId);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var child in allFolders.Where(f => f.ParentFolderId == current))
            {
                result.Add(child.FolderId);
                queue.Enqueue(child.FolderId);
            }
        }
        result.Reverse(); // bottom-up order for deletion
        return result;
    }

    private static Folder RebuildFolder(IReadOnlyList<EventEnvelope> history)
    {
        var folder = new Folder();
        foreach (var e in history)
            folder.Apply(EventDeserializer.Deserialize(e));
        return folder;
    }

    private List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, currentUser.UserId, currentWorkspace.WorkspaceId);
}
