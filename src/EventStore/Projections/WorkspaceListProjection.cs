using Domain.Workspaces;

namespace EventStore.Projections;

public sealed class WorkspaceListProjection
{
    private readonly Dictionary<WorkspaceId, WorkspaceListView> _workspaces = new();

    public void Handle(EventEnvelope envelope)
    {
        switch (EventDeserializer.Deserialize(envelope))
        {
            case WorkspaceCreated e:
                _workspaces[e.WorkspaceId] = new WorkspaceListView(e.WorkspaceId, e.Name, envelope.OccurredAt, envelope.Metadata.UserId ?? "");
                break;
            case WorkspaceRenamed e when _workspaces.TryGetValue(e.WorkspaceId, out var w):
                _workspaces[e.WorkspaceId] = w with { Name = e.NewName };
                break;
            case WorkspaceThemeSet e when _workspaces.TryGetValue(e.WorkspaceId, out var wt):
                _workspaces[e.WorkspaceId] = wt with { Theme = e.Theme };
                break;
            case WorkspaceDeleted e:
                _workspaces.Remove(e.WorkspaceId);
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<WorkspaceListView> GetAll() =>
        _workspaces.Values.OrderBy(w => w.CreatedAt).ToList().AsReadOnly();
}
