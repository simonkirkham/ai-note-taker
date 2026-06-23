namespace Domain.Notes;

public record RecordingUploaded(
    NoteId NoteId,
    string AudioKey
) : IDomainEvent;
