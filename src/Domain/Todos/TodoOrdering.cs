namespace Domain.Todos;

// Per-workspace ordering of the home To Do list. The list interleaves standalone todos and
// note-derived action items, so ordering is a list-level concern keyed by workspace rather than a
// position on either item aggregate. The aggregate is near-stateless: any non-empty order of any
// ids is valid and last-write-wins (a re-order simply appends a fresh snapshot).
public sealed class TodoOrdering : IAggregate
{
    public static string StreamId(string workspaceId) => $"todo-order#{workspaceId}";

    public void Apply(IDomainEvent @event)
    {
        // No state is required to validate a reorder; each TodoListReordered is a full snapshot.
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            ReorderTodos cmd => HandleReorder(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    static IReadOnlyList<IDomainEvent> HandleReorder(ReorderTodos cmd)
    {
        if (cmd.OrderedItemIds is null || cmd.OrderedItemIds.Count == 0)
            throw new ArgumentException("Order must contain at least one item.", nameof(cmd));
        return [new TodoListReordered(cmd.WorkspaceId, cmd.OrderedItemIds, cmd.ReorderedAt)];
    }
}
