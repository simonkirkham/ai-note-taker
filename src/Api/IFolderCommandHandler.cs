using Domain.Folders;

namespace Api;

public interface IFolderCommandHandler
{
    Task<FolderId> HandleAsync(CreateFolder cmd, CancellationToken ct = default);
    Task HandleAsync(RenameFolder cmd, CancellationToken ct = default);
    Task HandleAsync(DeleteFolder cmd, CancellationToken ct = default);
    Task HandleAsync(MoveFolder cmd, CancellationToken ct = default);
}
