namespace Domain.Notes;

public record UnlinkNoteFromCalendarEvent(
    NoteId NoteId
) : NoteCommand;
