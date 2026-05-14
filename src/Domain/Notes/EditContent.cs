namespace Domain.Notes;

public record EditContent(NoteId NoteId, string Content) : NoteCommand;
