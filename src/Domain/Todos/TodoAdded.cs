namespace Domain.Todos;

public record TodoAdded(TodoId TodoId, string UserId, string Description, string? Priority) : TodoEvent;
