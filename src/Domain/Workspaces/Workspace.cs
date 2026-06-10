namespace Domain.Workspaces;

public sealed class Workspace : IAggregate
{
    bool _exists;
    bool _deleted;
    string _name = string.Empty;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case WorkspaceCreated e:
                _exists = true;
                _name = e.Name;
                break;
            case WorkspaceRenamed e:
                _name = e.NewName;
                break;
            case WorkspaceDeleted:
                _deleted = true;
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) => command switch
    {
        CreateWorkspace cmd => HandleCreate(cmd),
        RenameWorkspace cmd => HandleRename(cmd),
        DeleteWorkspace cmd => HandleDelete(cmd),
        _ => throw new ArgumentOutOfRangeException(nameof(command))
    };

    IReadOnlyList<IDomainEvent> HandleCreate(CreateWorkspace cmd)
    {
        if (_exists)
            throw new InvalidOperationException("Workspace already exists.");
        if (string.IsNullOrWhiteSpace(cmd.Name))
            throw new InvalidOperationException("Workspace name must not be empty.");
        return [new WorkspaceCreated(cmd.WorkspaceId, cmd.Name)];
    }

    IReadOnlyList<IDomainEvent> HandleRename(RenameWorkspace cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Workspace does not exist.");
        if (string.IsNullOrWhiteSpace(cmd.NewName))
            throw new InvalidOperationException("Workspace name must not be empty.");
        if (cmd.NewName == _name)
            return [];
        return [new WorkspaceRenamed(cmd.WorkspaceId, cmd.NewName)];
    }

    IReadOnlyList<IDomainEvent> HandleDelete(DeleteWorkspace cmd)
    {
        if (cmd.WorkspaceId.IsDefault)
            throw new DefaultWorkspaceUndeletableException();
        if (!_exists || _deleted)
            throw new InvalidOperationException("Workspace does not exist.");
        return [new WorkspaceDeleted(cmd.WorkspaceId)];
    }
}
