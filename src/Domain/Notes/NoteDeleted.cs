namespace Domain.Notes;

public record NoteDeleted(NoteId NoteId) : NoteEvent;
