namespace Domain.Notes;

public abstract record NoteEvent : IDomainEvent;

public record NoteCreated(NoteId NoteId) : NoteEvent;
public record NoteRenamed(NoteId NoteId, string NewTitle) : NoteEvent;
public record ContentEdited(NoteId NoteId, string NewContent) : NoteEvent;
public record ContentEditedV2(NoteId NoteId, string NewContent, int CharacterCount) : NoteEvent;
public record NoteDeleted(NoteId NoteId) : NoteEvent;
public record NoteDateSet(NoteId NoteId, DateOnly? Date) : NoteEvent;
