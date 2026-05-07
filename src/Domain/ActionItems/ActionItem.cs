namespace Domain.ActionItems;

public sealed class ActionItem : IAggregate
{
    bool _exists;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case ActionItemAdded:
                _exists = true;
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            AddActionItem cmd => HandleAdd(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    IReadOnlyList<IDomainEvent> HandleAdd(AddActionItem cmd)
    {
        if (_exists)
            throw new InvalidOperationException($"Action item {cmd.ActionId} already exists.");
        return [new ActionItemAdded(cmd.ActionId, cmd.NoteId, cmd.Description)];
    }
}
