namespace Domain.Todos;

public record DeleteTodo(TodoId TodoId, DateTimeOffset DeletedAt) : TodoCommand;
