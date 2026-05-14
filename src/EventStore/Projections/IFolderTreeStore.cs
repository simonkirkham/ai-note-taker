using Domain.Folders;

namespace EventStore.Projections;

public interface IFolderTreeStore
{
    Task UpsertAsync(FolderTreeView folder, CancellationToken ct = default);
    Task<IReadOnlyList<FolderTreeView>> GetAllAsync(CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
}
