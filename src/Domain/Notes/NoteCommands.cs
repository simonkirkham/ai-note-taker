namespace Domain.Notes;

public abstract record NoteCommand : ICommand;

public record CreateNote(NoteId NoteId) : NoteCommand;
public record RenameNote(NoteId NoteId, string NewTitle) : NoteCommand;
