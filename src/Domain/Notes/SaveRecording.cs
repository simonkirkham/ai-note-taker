namespace Domain.Notes;

public record SaveRecording(
    NoteId NoteId,
    string AudioKey
) : NoteCommand;
