using Domain.Folders;

namespace Api.CommandHandlers;

public interface IFolderCommandHandler
{
    Task<long> HandleAsync(CreateFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(RenameFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteFolder cmd, CancellationToken ct = default);
    Task<long> HandleAsync(MoveFolder cmd, CancellationToken ct = default);
}
