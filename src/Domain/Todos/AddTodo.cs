namespace Domain.Todos;

public record AddTodo(TodoId TodoId, string UserId, string Description, string? Priority) : TodoCommand;
