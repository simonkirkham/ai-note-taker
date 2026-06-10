using Domain.Folders;

namespace EventStore.Projections;

public sealed class FolderTreeProjection
{
    private readonly Dictionary<FolderId, FolderTreeView> _folders = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case FolderCreated e:
                _folders[e.FolderId] = new FolderTreeView(e.FolderId, e.Name, e.ParentFolderId, envelope.OccurredAt, envelope.Metadata.UserId ?? "", envelope.Metadata.WorkspaceId);
                break;
            case FolderRenamed e when _folders.TryGetValue(e.FolderId, out var f):
                _folders[e.FolderId] = f with { Name = e.NewName };
                break;
            case FolderDeleted e:
                _folders.Remove(e.FolderId);
                break;
            case FolderMoved e when _folders.TryGetValue(e.FolderId, out var f):
                _folders[e.FolderId] = f with { ParentFolderId = e.NewParentFolderId };
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<FolderTreeView> GetAll() =>
        _folders.Values.OrderBy(f => f.CreatedAt).ToList().AsReadOnly();
}
