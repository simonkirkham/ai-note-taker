namespace Domain.Todos;

public record TodoDeleted(TodoId TodoId, DateTimeOffset DeletedAt) : TodoEvent;
