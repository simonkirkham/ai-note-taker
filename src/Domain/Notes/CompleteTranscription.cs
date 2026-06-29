namespace Domain.Notes;

public record CompleteTranscription(
    NoteId NoteId,
    string TranscriptText,
    int DurationSeconds
) : NoteCommand;
