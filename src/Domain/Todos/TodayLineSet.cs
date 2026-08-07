namespace Domain.Todos;

public record TodayLineSet(string WorkspaceId, string? AnchorItemId, DateTimeOffset SetAt) : TodoOrderingEvent;
