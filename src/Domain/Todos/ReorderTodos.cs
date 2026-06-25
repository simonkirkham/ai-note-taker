namespace Domain.Todos;

public record ReorderTodos(string WorkspaceId, IReadOnlyList<string> OrderedItemIds, DateTimeOffset ReorderedAt) : TodoOrderingCommand;
