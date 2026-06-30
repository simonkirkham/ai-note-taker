namespace Domain.Notes;

public record RemoveAgendaItem(NoteId NoteId, Guid ItemId) : NoteCommand;
