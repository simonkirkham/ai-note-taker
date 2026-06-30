namespace Domain.Notes;

public record AgendaItemDiscussedSet(NoteId NoteId, Guid ItemId, bool Discussed) : NoteEvent;
