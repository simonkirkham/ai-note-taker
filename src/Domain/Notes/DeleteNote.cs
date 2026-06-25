namespace Domain.Notes;

public record DeleteNote(NoteId NoteId) : NoteCommand;
