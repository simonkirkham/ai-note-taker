using Domain.Workspaces;

namespace Api.CommandHandlers;

public interface IWorkspaceCommandHandler
{
    Task<long> HandleAsync(CreateWorkspace cmd, CancellationToken ct = default);
    Task<long> HandleAsync(RenameWorkspace cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteWorkspace cmd, CancellationToken ct = default);
    Task<long> HandleAsync(ConnectWorkspaceCalendar cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DisconnectWorkspaceCalendar cmd, CancellationToken ct = default);
    Task<long> HandleAsync(SetWorkspaceTheme cmd, CancellationToken ct = default);
}
