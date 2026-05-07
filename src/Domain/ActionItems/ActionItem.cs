namespace Domain.ActionItems;

public sealed class ActionItem : IAggregate
{
    bool _exists;
    bool _completed;
    bool _deleted;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case ActionItemAdded:
                _exists = true;
                break;
            case ActionItemCompleted:
                _completed = true;
                break;
            case ActionItemReopened:
                _completed = false;
                break;
            case ActionItemDeleted:
                _deleted = true;
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            AddActionItem cmd      => HandleAdd(cmd),
            CompleteActionItem cmd => HandleComplete(cmd),
            ReopenActionItem cmd   => HandleReopen(cmd),
            DeleteActionItem cmd   => HandleDelete(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    IReadOnlyList<IDomainEvent> HandleAdd(AddActionItem cmd)
    {
        if (_exists)
            throw new InvalidOperationException($"Action item {cmd.ActionId} already exists.");
        return [new ActionItemAdded(cmd.ActionId, cmd.NoteId, cmd.Description)];
    }

    IReadOnlyList<IDomainEvent> HandleComplete(CompleteActionItem cmd)
    {
        if (_deleted || _completed)
            throw new InvalidOperationException($"Action item {cmd.ActionId} cannot be completed.");
        return [new ActionItemCompleted(cmd.ActionId, cmd.CompletedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleReopen(ReopenActionItem cmd)
    {
        if (_deleted || !_completed)
            throw new InvalidOperationException($"Action item {cmd.ActionId} cannot be reopened.");
        return [new ActionItemReopened(cmd.ActionId, cmd.ReopenedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleDelete(DeleteActionItem cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Action item {cmd.ActionId} does not exist.");
        return [new ActionItemDeleted(cmd.ActionId, cmd.DeletedAt)];
    }
}
