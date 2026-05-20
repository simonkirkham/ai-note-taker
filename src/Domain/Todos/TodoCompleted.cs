namespace Domain.Todos;

public record TodoCompleted(TodoId TodoId, DateTimeOffset CompletedAt) : TodoEvent;
