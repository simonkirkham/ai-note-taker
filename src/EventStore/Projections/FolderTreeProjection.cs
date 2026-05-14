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
                _folders[e.FolderId] = new FolderTreeView(e.FolderId, e.Name, e.ParentFolderId, envelope.OccurredAt);
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<FolderTreeView> GetAll() =>
        _folders.Values.OrderBy(f => f.CreatedAt).ToList().AsReadOnly();
}
