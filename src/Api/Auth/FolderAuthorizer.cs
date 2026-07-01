using Domain.Folders;
using EventStore;
using Microsoft.Extensions.Logging;

namespace Api.Auth;

// 47-C: strongly-consistent folder ownership read from the folder's EVENT STREAM — the object-level
// auth a folder-scoped write (rename / delete / reparent) needs. Owning any folder + knowing a foreign
// folderId must not let you mutate it (BUG-41). The owner is the UserId stamped on the folder's first
// event (FolderCreated), the same rule NoteAuthorizer/ActionItemAuthorizer use. Event stream, NOT the
// async FolderTree projection — a projection read would 404 a just-created folder (BUG-30).
public interface IFolderAuthorizer
{
    Task<bool> OwnsFolderAsync(FolderId folderId, string userId, CancellationToken ct = default);
}

public sealed class FolderAuthorizer(IEventStore store, ILogger<FolderAuthorizer>? logger = null) : IFolderAuthorizer
{
    public async Task<bool> OwnsFolderAsync(FolderId folderId, string userId, CancellationToken ct = default)
    {
        var history = await store.ReadAsync(folderId.ToStreamId(), ct).ConfigureAwait(false);
        if (history.Count == 0)                                          // never created
            return false;
        if (history.Any(e => e.EventType == nameof(FolderDeleted)))      // deleted (no un-delete)
            return false;
        // Owner = the UserId on the first event. A null owner is a legacy pre-workspace folder → not
        // enforced (matches NoteAuthorizer). An owner mismatch is a cross-user attempt.
        var owner = history[0].Metadata.UserId;
        var owns = owner is null || owner == userId;
        if (!owns)
            logger?.LogWarning("folder-auth denied: owner {Owner} != {User} for {Stream}", owner, userId, folderId.ToStreamId());
        return owns;
    }
}
