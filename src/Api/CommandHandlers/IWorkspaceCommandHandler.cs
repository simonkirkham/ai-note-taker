using Domain.Workspaces;

namespace Api.CommandHandlers;

public interface IWorkspaceCommandHandler
{
    Task<WorkspaceId> HandleAsync(CreateWorkspace cmd, CancellationToken ct = default);
    Task HandleAsync(RenameWorkspace cmd, CancellationToken ct = default);
    Task HandleAsync(DeleteWorkspace cmd, CancellationToken ct = default);
}
