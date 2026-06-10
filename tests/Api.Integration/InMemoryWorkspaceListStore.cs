using Domain.Workspaces;
using EventStore.Projections;

namespace Api.Integration;

internal sealed class InMemoryWorkspaceListStore : IWorkspaceListStore
{
    private readonly Dictionary<WorkspaceId, WorkspaceListView> _workspaces = new();

    public Task UpsertAsync(WorkspaceListView workspace, CancellationToken ct = default)
    {
        _workspaces[workspace.WorkspaceId] = workspace;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<WorkspaceListView>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<WorkspaceListView>>(
            _workspaces.Values.OrderBy(w => w.CreatedAt).ToList().AsReadOnly());

    public Task DeleteAsync(WorkspaceId workspaceId, CancellationToken ct = default)
    {
        _workspaces.Remove(workspaceId);
        return Task.CompletedTask;
    }
}
