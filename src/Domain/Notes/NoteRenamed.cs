namespace Domain.Notes;

public record NoteRenamed(NoteId NoteId, string NewTitle) : NoteEvent;
