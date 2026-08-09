using Domain.Folders;

namespace Api.CommandHandlers;

// A folder delete writes to two scopes: the folder stream itself, and — via the unfile cascade —
// one NOTE stream per contained note. The cards list gate holds a single stream token (design
// decision #7), so the cascade is represented by its LAST unfile write; null when the folder held
// no notes and nothing note-side was written. BUG-46.
public readonly record struct FolderDeleteResult(long Version, string? NoteCardsToken);

public interface IFolderCommandHandler
{
    Task<long> HandleAsync(CreateFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(RenameFolder cmd, CancellationToken ct = default);
    Task<FolderDeleteResult> HandleAsync(DeleteFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(MoveFolder cmd, CancellationToken ct = default);

    // Identity-explicit overload (47-A): a non-HTTP caller (the MCP folder tools) passes the owner +
    // workspace explicitly, so the folder events are stamped with the token `sub` rather than the
    // route's scoped ICurrentUser/ICurrentWorkspace. Mirrors INoteCommandHandler (33-B2). Rename/Delete/
    // Move gain their overloads when their MCP tools land (47-C/47-D).
    Task<long> HandleAsync(CreateFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<long> HandleAsync(RenameFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<FolderDeleteResult> HandleAsync(DeleteFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<long> HandleAsync(MoveFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
}
