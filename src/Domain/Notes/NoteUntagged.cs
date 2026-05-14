namespace Domain.Notes;

public record NoteUntagged(NoteId NoteId, string Tag) : NoteEvent;
