using Domain;
using Domain.Folders;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;
using Api.Utilities;

namespace Api.CommandHandlers;

// Append-only since RYW-3b: the Folder aggregate is async — the projector (the in-process
// SyncProjectingEventStore decorator in tests/local, the Projector Lambda in prod) is the sole
// writer of the folder tree projection, no inline ProjectionUpdater/folderTreeStore write. Each
// HandleAsync returns the target folder stream's new version (the write token); the folder read
// waits on proj-position before answering. folderTreeStore is still READ here (subtree/cycle
// computation), just never written. A cascade delete appends DeleteFolder to each descendant
// stream too — the projector deletes each as its own append lands (folder- is migrated); the write
// token is the target folder's version (design decision #7 — wait on the stream the user wrote).
public sealed class FolderCommandHandler(
    IEventStore store,
    IFolderTreeStore folderTreeStore,
    INoteCardListStore noteCardListStore,
    INoteCommandHandler noteCommandHandler,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<FolderCommandHandler> logger) : IFolderCommandHandler
{
    public Task<long> HandleAsync(CreateFolder cmd, CancellationToken ct = default) =>
        HandleAsync(cmd, currentUser.UserId, currentWorkspace.WorkspaceId, ct);

    // Identity-explicit overload (47-A): stamp the folder events with the caller-supplied owner +
    // workspace (the MCP token `sub`) instead of the scoped ICurrentUser/ICurrentWorkspace.
    public Task<long> HandleAsync(CreateFolder cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(CreateFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var newEvents = RebuildFolder(history).Handle(cmd);
            return await PersistFolderAsync(streamId, history, newEvents, userId, workspaceId, ct).ConfigureAwait(false);
        });

    public Task<long> HandleAsync(RenameFolder cmd, CancellationToken ct = default) =>
        HandleAsync(cmd, currentUser.UserId, currentWorkspace.WorkspaceId, ct);

    public Task<long> HandleAsync(RenameFolder cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(RenameFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new FolderNotFoundException(cmd.FolderId);
            var newEvents = RebuildFolder(history).Handle(cmd);
            // No-op command: nothing appended, so the write token is the current version.
            if (newEvents.Count == 0) return (long)history.Count;
            return await PersistFolderAsync(streamId, history, newEvents, userId, workspaceId, ct).ConfigureAwait(false);
        });

    public Task<FolderDeleteResult> HandleAsync(DeleteFolder cmd, CancellationToken ct = default) =>
        HandleAsync(cmd, currentUser.UserId, currentWorkspace.WorkspaceId, ct);

    public Task<FolderDeleteResult> HandleAsync(DeleteFolder cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, nameof(DeleteFolder), "Folder", async () =>
        {
            var streamId = cmd.FolderId.ToStreamId();
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            if (history.Count == 0) throw new InvalidOperationException("Folder does not exist.");

            var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
            var subtreeIds = GetSubtreeIds(cmd.FolderId, allFolders);

            // Unfile notes in descendants + root folder (order doesn't matter for unfiling). Each
            // unfile is a NOTE-stream write, so the caller needs the last one's token to gate the
            // cards-list read that follows the delete (BUG-46). The cards gate holds ONE token
            // (design decision #7), so with N notes this gates 1 of N — a strict improvement, fully
            // correct for N=1, and never worse than not gating at all. Which one is arbitrary: the
            // notes are iterated in the cards projection's SCAN order, so "last" means last appended
            // in an order we do not control, and it says nothing about the other N-1 streams.
            // The cards projection is read ONCE for the whole cascade: QueryAllAsync is a full scan,
            // so doing it per folder made a 10-folder subtree cost 10 scans.
            var allCards = await noteCardListStore.QueryAllAsync(ct).ConfigureAwait(false);
            string? noteCardsToken = null;
            foreach (var folderId in subtreeIds.Concat([cmd.FolderId]))
                noteCardsToken = await UnfileNotesInFolderAsync(allCards, folderId, userId, workspaceId, ct).ConfigureAwait(false)
                    ?? noteCardsToken;

            // Delete descendant folders bottom-up (subtreeIds already in bottom-up order)
            foreach (var folderId in subtreeIds)
                await DeleteOneFolderAsync(folderId, userId, workspaceId, ct).ConfigureAwait(false);

            // Delete the target folder — the projector removes its tree row off the appended event.
            var newEvents = RebuildFolder(history).Handle(cmd);
            var envelopes = ToEnvelopes(streamId, newEvents, userId, workspaceId);
            await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            return new FolderDeleteResult(history.Count + envelopes.Count, noteCardsToken);
        });

    public Task<long> HandleAsync(MoveFolder cmd, CancellationToken ct = default) =>
        HandleAsync(cmd, currentUser.UserId, currentWorkspace.WorkspaceId, ct);

    public Task<long> HandleAsync(MoveFolder cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
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
            return await PersistFolderAsync(streamId, history, newEvents, userId, workspaceId, ct).ConfigureAwait(false);
        });

    // Returns the last-appended unfile write's note-stream token (scan order — see DeleteFolder),
    // or null when the folder held no notes.
    // Takes the already-read cards snapshot — see the single QueryAllAsync in DeleteFolder.
    private async Task<string?> UnfileNotesInFolderAsync(IReadOnlyList<NoteCardView> allCards, FolderId folderId, string userId, string? workspaceId, CancellationToken ct)
    {
        var notesInFolder = allCards.Where(c => c.FolderId == folderId && !c.Deleted && c.UserId == userId).ToList();
        string? lastToken = null;
        foreach (var card in notesInFolder)
        {
            var version = await noteCommandHandler.HandleAsync(new UnfileNote(card.NoteId), userId, workspaceId, ct).ConfigureAwait(false);
            lastToken = $"{card.NoteId.ToStreamId()}@{version}";
        }
        return lastToken;
    }

    private async Task DeleteOneFolderAsync(FolderId folderId, string userId, string? workspaceId, CancellationToken ct)
    {
        var streamId = folderId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) return;
        var newEvents = RebuildFolder(history).Handle(new DeleteFolder(folderId));
        var envelopes = ToEnvelopes(streamId, newEvents, userId, workspaceId);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
    }

    private async Task<long> PersistFolderAsync(string streamId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, string userId, string? workspaceId, CancellationToken ct)
    {
        var envelopes = ToEnvelopes(streamId, newEvents, userId, workspaceId);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        return history.Count + envelopes.Count;
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

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events, string userId, string? workspaceId) =>
        EventEnvelopeFactory.CreateEnvelopes(streamId, events, userId, workspaceId);
}
