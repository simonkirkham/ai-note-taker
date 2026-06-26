namespace Domain.Todos;

public record EditTodo(TodoId TodoId, string NewDescription, DateTimeOffset EditedAt) : TodoCommand;
