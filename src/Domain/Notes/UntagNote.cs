namespace Domain.Notes;

public record UntagNote(NoteId NoteId, string Tag) : NoteCommand;
