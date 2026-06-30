namespace Domain.Notes;

public record AgendaItemTextEdited(NoteId NoteId, Guid ItemId, string Text) : NoteEvent;
