namespace Domain.ActionItems;

public sealed class ActionItem : IAggregate
{
    bool _exists;
    bool _completed;

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
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            AddActionItem cmd      => HandleAdd(cmd),
            CompleteActionItem cmd => HandleComplete(cmd),
            ReopenActionItem cmd   => HandleReopen(cmd),
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
        if (_completed)
            throw new InvalidOperationException($"Action item {cmd.ActionId} is already completed.");
        return [new ActionItemCompleted(cmd.ActionId, cmd.CompletedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleReopen(ReopenActionItem cmd)
    {
        if (!_completed)
            throw new InvalidOperationException($"Action item {cmd.ActionId} is not completed.");
        return [new ActionItemReopened(cmd.ActionId, cmd.ReopenedAt)];
    }
}
