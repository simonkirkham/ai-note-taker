namespace Domain.Notes;

public record ContentEdited(NoteId NoteId, string NewContent) : NoteEvent;
