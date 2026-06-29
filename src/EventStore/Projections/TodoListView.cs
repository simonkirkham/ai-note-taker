namespace EventStore.Projections;

public record TodoListView(IReadOnlyList<TodoItem> Items);
