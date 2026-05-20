namespace Domain.Notes;

public record TranscriptionCompleted(
    NoteId NoteId,
    string TranscriptText,
    int DurationSeconds
) : IDomainEvent;
