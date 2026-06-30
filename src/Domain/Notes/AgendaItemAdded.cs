namespace Domain.Notes;

public record AgendaItemAdded(NoteId NoteId, Guid ItemId, string Text, int Position) : NoteEvent;
