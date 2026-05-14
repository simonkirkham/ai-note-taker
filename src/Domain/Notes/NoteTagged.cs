namespace Domain.Notes;

public record NoteTagged(NoteId NoteId, string Tag) : NoteEvent;
