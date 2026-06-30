namespace Domain.Notes;

public record SetAgendaItemDiscussed(NoteId NoteId, Guid ItemId, bool Discussed) : NoteCommand;
