namespace Domain.Notes;

public abstract record NoteCommand : ICommand;

public record CreateNote(NoteId NoteId) : NoteCommand;
public record RenameNote(NoteId NoteId, string NewTitle) : NoteCommand;
public record EditContent(NoteId NoteId, string Content) : NoteCommand;
public record DeleteNote(NoteId NoteId) : NoteCommand;
public record SetNoteDate(NoteId NoteId, DateOnly? Date) : NoteCommand;
