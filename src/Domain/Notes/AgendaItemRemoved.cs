namespace Domain.Notes;

public record AgendaItemRemoved(NoteId NoteId, Guid ItemId) : NoteEvent;
