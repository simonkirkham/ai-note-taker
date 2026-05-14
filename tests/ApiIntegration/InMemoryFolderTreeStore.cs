using Domain.Folders;
using EventStore.Projections;

namespace ApiIntegration;

internal sealed class InMemoryFolderTreeStore : IFolderTreeStore
{
    private readonly Dictionary<FolderId, FolderTreeView> _folders = new();

    public Task UpsertAsync(FolderTreeView folder, CancellationToken ct = default)
    {
        _folders[folder.FolderId] = folder;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<FolderTreeView>> GetAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<FolderTreeView>>(
            _folders.Values.OrderBy(f => f.CreatedAt).ToList().AsReadOnly());

    public Task DeleteAllAsync(CancellationToken ct = default)
    {
        _folders.Clear();
        return Task.CompletedTask;
    }
}
