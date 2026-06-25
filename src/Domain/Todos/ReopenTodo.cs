namespace Domain.Todos;

public record ReopenTodo(TodoId TodoId, DateTimeOffset ReopenedAt) : TodoCommand;
