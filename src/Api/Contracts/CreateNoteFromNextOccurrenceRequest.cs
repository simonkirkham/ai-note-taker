namespace Api.Contracts;

public record CreateNoteFromNextOccurrenceRequest(
    string RecurringSeriesId,
    string TodayCalendarEventId);
