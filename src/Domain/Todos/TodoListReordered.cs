namespace Domain.Todos;

public record TodoListReordered(string WorkspaceId, IReadOnlyList<string> OrderedItemIds, DateTimeOffset ReorderedAt) : TodoOrderingEvent;
