namespace Domain.Todos;

public record TodoReopened(TodoId TodoId, DateTimeOffset ReopenedAt) : TodoEvent;
