namespace Domain.Notes;

public record RecordDiarizedTranscription(
    NoteId NoteId,
    string Text,
    int SpeakerCount,
    string JobId,
    string SourceAudioKey
) : NoteCommand;
