namespace Domain.Notes;

public record NoteUnlinkedFromCalendarEvent(
    NoteId NoteId,
    string PreviousCalendarEventId
) : NoteEvent;
