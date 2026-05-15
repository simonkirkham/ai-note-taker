namespace Domain.Folders;

public sealed class Folder : IAggregate
{
    bool _exists;
    bool _deleted;
    string _name = string.Empty;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case FolderCreated e:
                _exists = true;
                _name = e.Name;
                break;
            case FolderRenamed e:
                _name = e.NewName;
                break;
            case FolderDeleted:
                _deleted = true;
                break;
            case FolderMoved:
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) => command switch
    {
        CreateFolder cmd  => HandleCreate(cmd),
        RenameFolder cmd  => HandleRename(cmd),
        DeleteFolder cmd  => HandleDelete(cmd),
        MoveFolder cmd    => HandleMove(cmd),
        _ => throw new ArgumentOutOfRangeException(nameof(command))
    };

    IReadOnlyList<IDomainEvent> HandleCreate(CreateFolder cmd)
    {
        if (_exists)
            throw new InvalidOperationException("Folder already exists.");
        if (string.IsNullOrWhiteSpace(cmd.Name))
            throw new InvalidOperationException("Folder name must not be empty.");
        return [new FolderCreated(cmd.FolderId, cmd.Name, cmd.ParentFolderId)];
    }

    IReadOnlyList<IDomainEvent> HandleRename(RenameFolder cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Folder does not exist.");
        if (string.IsNullOrWhiteSpace(cmd.NewName))
            throw new InvalidOperationException("Folder name must not be empty.");
        if (cmd.NewName == _name)
            return [];
        return [new FolderRenamed(cmd.FolderId, cmd.NewName)];
    }

    IReadOnlyList<IDomainEvent> HandleDelete(DeleteFolder cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Folder does not exist.");
        return [new FolderDeleted(cmd.FolderId)];
    }

    IReadOnlyList<IDomainEvent> HandleMove(MoveFolder cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException("Folder does not exist.");
        return [new FolderMoved(cmd.FolderId, cmd.NewParentFolderId)];
    }
}
