namespace Domain.Todos;

// Per-workspace ordering of the home To Do list, plus the position of the "Today" line within it.
// The list interleaves standalone todos and note-derived action items, so ordering is a list-level
// concern keyed by workspace rather than a position on either item aggregate. The aggregate is
// near-stateless: any non-empty order of any ids is valid and last-write-wins (a re-order simply
// appends a fresh snapshot), and the Today line is likewise a last-write-wins marker.
public sealed class TodoOrdering : IAggregate
{
    public static string StreamId(string workspaceId) => $"todo-order#{workspaceId}";

    public void Apply(IDomainEvent @event)
    {
        // No state is required to validate a reorder; each TodoListReordered is a full snapshot.
        // The same holds for the Today line — each TodayLineSet replaces the previous position.
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            ReorderTodos cmd => HandleReorder(cmd),
            SetTodayLine cmd => HandleSetTodayLine(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    static IReadOnlyList<IDomainEvent> HandleReorder(ReorderTodos cmd)
    {
        if (cmd.OrderedItemIds is null || cmd.OrderedItemIds.Count == 0)
            throw new ArgumentException("Order must contain at least one item.", nameof(cmd));
        return [new TodoListReordered(cmd.WorkspaceId, cmd.OrderedItemIds, cmd.ReorderedAt)];
    }

    static IReadOnlyList<IDomainEvent> HandleSetTodayLine(SetTodayLine cmd)
    {
        // null is the meaningful "below everything" position; a blank string is a client bug.
        if (cmd.AnchorItemId is not null && string.IsNullOrWhiteSpace(cmd.AnchorItemId))
            throw new ArgumentException("Anchor item id must be an item id or null.", nameof(cmd));
        return [new TodayLineSet(cmd.WorkspaceId, cmd.AnchorItemId, cmd.SetAt)];
    }
}
