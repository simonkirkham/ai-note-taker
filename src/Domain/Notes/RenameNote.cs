namespace Domain.Notes;

public record RenameNote(NoteId NoteId, string NewTitle) : NoteCommand;
