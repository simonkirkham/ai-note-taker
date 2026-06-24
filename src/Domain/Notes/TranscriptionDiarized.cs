namespace Domain.Notes;

public record TranscriptionDiarized(
    NoteId NoteId,
    string Text,
    int SpeakerCount,
    string JobId,
    string SourceAudioKey
) : IDomainEvent;
