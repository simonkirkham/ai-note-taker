namespace Domain.Notes;

public record NoteDateSet(NoteId NoteId, DateOnly? Date) : NoteEvent;
