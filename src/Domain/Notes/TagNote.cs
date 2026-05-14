namespace Domain.Notes;

public record TagNote(NoteId NoteId, string Tag) : NoteCommand;
