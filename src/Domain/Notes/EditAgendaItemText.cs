namespace Domain.Notes;

public record EditAgendaItemText(NoteId NoteId, Guid ItemId, string Text) : NoteCommand;
