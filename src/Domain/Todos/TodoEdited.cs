namespace Domain.Todos;

public record TodoEdited(TodoId TodoId, string NewDescription, DateTimeOffset EditedAt) : TodoEvent;
