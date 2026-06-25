namespace Domain.Workspaces;

public sealed class Workspace : IAggregate
{
    bool _exists;
    bool _deleted;
    string _name = string.Empty;
    string? _calendarProvider;
    string? _calendarAccountRef;

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
            case WorkspaceCalendarConnected e:
                _calendarProvider = e.Provider;
                _calendarAccountRef = e.AccountRef;
                break;
            case WorkspaceCalendarDisconnected:
                _calendarProvider = null;
                _calendarAccountRef = null;
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
        ConnectWorkspaceCalendar cmd => HandleConnectCalendar(cmd),
        DisconnectWorkspaceCalendar cmd => HandleDisconnectCalendar(cmd),
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

    IReadOnlyList<IDomainEvent> HandleConnectCalendar(ConnectWorkspaceCalendar cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Workspace does not exist.");
        if (string.IsNullOrWhiteSpace(cmd.Provider))
            throw new InvalidOperationException("Calendar provider must not be empty.");
        // Reconnecting the same provider+account is a no-op (a deliberate reconnect to a different
        // account or provider re-emits to update the stored reference).
        if (_calendarProvider == cmd.Provider && _calendarAccountRef == cmd.AccountRef)
            return [];
        return [new WorkspaceCalendarConnected(cmd.WorkspaceId, cmd.Provider, cmd.AccountRef)];
    }

    IReadOnlyList<IDomainEvent> HandleDisconnectCalendar(DisconnectWorkspaceCalendar cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Workspace does not exist.");
        if (_calendarProvider is null)
            return [];
        return [new WorkspaceCalendarDisconnected(cmd.WorkspaceId)];
    }
}
