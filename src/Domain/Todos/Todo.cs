namespace Domain.Todos;

public sealed class Todo : IAggregate
{
    bool _exists;
    bool _completed;
    bool _deleted;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case TodoAdded:
                _exists = true;
                break;
            case TodoCompleted:
                _completed = true;
                break;
            case TodoReopened:
                _completed = false;
                break;
            case TodoDeleted:
                _deleted = true;
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            AddTodo cmd => HandleAdd(cmd),
            CompleteTodo cmd => HandleComplete(cmd),
            ReopenTodo cmd => HandleReopen(cmd),
            EditTodo cmd => HandleEdit(cmd),
            DeleteTodo cmd => HandleDelete(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    IReadOnlyList<IDomainEvent> HandleAdd(AddTodo cmd)
    {
        if (_exists)
            throw new InvalidOperationException($"Todo {cmd.TodoId} already exists.");
        if (string.IsNullOrWhiteSpace(cmd.Description))
            throw new ArgumentException("Description must not be empty.", nameof(cmd));
        return [new TodoAdded(cmd.TodoId, cmd.UserId, cmd.Description, cmd.Priority)];
    }

    IReadOnlyList<IDomainEvent> HandleComplete(CompleteTodo cmd)
    {
        if (!_exists || _deleted || _completed)
            throw new InvalidOperationException($"Todo {cmd.TodoId} cannot be completed.");
        return [new TodoCompleted(cmd.TodoId, cmd.CompletedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleReopen(ReopenTodo cmd)
    {
        if (!_exists || _deleted || !_completed)
            throw new InvalidOperationException($"Todo {cmd.TodoId} cannot be reopened.");
        return [new TodoReopened(cmd.TodoId, cmd.ReopenedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleEdit(EditTodo cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Todo {cmd.TodoId} cannot be edited.");
        if (string.IsNullOrWhiteSpace(cmd.NewDescription))
            throw new ArgumentException("Description must not be empty.", nameof(cmd));
        return [new TodoEdited(cmd.TodoId, cmd.NewDescription, cmd.EditedAt)];
    }

    IReadOnlyList<IDomainEvent> HandleDelete(DeleteTodo cmd)
    {
        if (!_exists || _deleted)
            throw new InvalidOperationException($"Todo {cmd.TodoId} cannot be deleted.");
        return [new TodoDeleted(cmd.TodoId, cmd.DeletedAt)];
    }
}
