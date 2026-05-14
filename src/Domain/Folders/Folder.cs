namespace Domain.Folders;

public sealed class Folder : IAggregate
{
    bool _exists;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case FolderCreated:
                _exists = true;
                break;
            default:
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) => command switch
    {
        CreateFolder cmd => HandleCreate(cmd),
        _ => throw new ArgumentOutOfRangeException(nameof(command))
    };

    IReadOnlyList<IDomainEvent> HandleCreate(CreateFolder cmd)
    {
        if (string.IsNullOrWhiteSpace(cmd.Name))
            throw new InvalidOperationException("Folder name must not be empty.");
        return [new FolderCreated(cmd.FolderId, cmd.Name, cmd.ParentFolderId)];
    }
}
