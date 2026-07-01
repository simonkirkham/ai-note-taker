using Domain.Folders;

namespace Api.CommandHandlers;

public interface IFolderCommandHandler
{
    Task<long> HandleAsync(CreateFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(RenameFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(MoveFolder cmd, CancellationToken ct = default);

    // Identity-explicit overload (47-A): a non-HTTP caller (the MCP folder tools) passes the owner +
    // workspace explicitly, so the folder events are stamped with the token `sub` rather than the
    // route's scoped ICurrentUser/ICurrentWorkspace. Mirrors INoteCommandHandler (33-B2). Rename/Delete/
    // Move gain their overloads when their MCP tools land (47-C/47-D).
    Task<long> HandleAsync(CreateFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<long> HandleAsync(RenameFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
    Task<long> HandleAsync(MoveFolder cmd, string userId, string? workspaceId, CancellationToken ct = default);
}
