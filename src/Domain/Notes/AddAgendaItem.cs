namespace Domain.Notes;

public record AddAgendaItem(NoteId NoteId, Guid ItemId, string Text) : NoteCommand;
