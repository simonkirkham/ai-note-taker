namespace Domain.Notes;

public record RecordTagSuggestions(NoteId NoteId, IReadOnlyList<string> Tags, string ModelId, string PromptVersion) : NoteCommand;
