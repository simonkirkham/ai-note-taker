namespace Domain.Todos;

public record CompleteTodo(TodoId TodoId, DateTimeOffset CompletedAt) : TodoCommand;
