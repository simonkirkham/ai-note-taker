namespace Domain.Notes;

public record RecordTagSuggestions(NoteId NoteId, IReadOnlyList<string> Tags) : NoteCommand;
