namespace Domain.Notes;

public record RecordActionItemSuggestions(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds, string ModelId, string PromptVersion) : NoteCommand;
