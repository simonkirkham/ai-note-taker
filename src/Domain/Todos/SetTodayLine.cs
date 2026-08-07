namespace Domain.Todos;

// Place the home To Do list's "Today" line. The line sits immediately ABOVE AnchorItemId;
// a null anchor puts it below every item (everything is Today).
public record SetTodayLine(string WorkspaceId, string? AnchorItemId, DateTimeOffset SetAt) : TodoOrderingCommand;
