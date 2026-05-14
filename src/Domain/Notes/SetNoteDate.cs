namespace Domain.Notes;

public record SetNoteDate(NoteId NoteId, DateOnly? Date) : NoteCommand;
