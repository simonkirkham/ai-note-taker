namespace Domain.Notes;

public abstract record NoteEvent : IDomainEvent;

public record NoteCreated(NoteId NoteId) : NoteEvent;
public record NoteRenamed(NoteId NoteId, string NewTitle) : NoteEvent;
