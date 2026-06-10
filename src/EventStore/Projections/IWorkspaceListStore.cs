using Domain.Workspaces;

namespace EventStore.Projections;

public interface IWorkspaceListStore
{
    Task UpsertAsync(WorkspaceListView workspace, CancellationToken ct = default);
    Task<IReadOnlyList<WorkspaceListView>> GetAllAsync(CancellationToken ct = default);
    Task DeleteAsync(WorkspaceId workspaceId, CancellationToken ct = default);
}
