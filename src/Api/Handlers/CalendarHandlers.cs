using Api.Services;

namespace Api.Handlers;

public static class CalendarHandlers
{
    public static async Task<IResult> GetTodaysMeetings(string? tz, IGoogleCalendarClient calendar)
    {
        if (string.IsNullOrWhiteSpace(tz))
            return Results.BadRequest(new { error = "tz parameter is required" });

        var events = await calendar.GetTodaysEventsAsync(tz);
        if (events is null)
            return Results.Ok(new { error = "calendar_unavailable" });

        var meetings = events.OrderBy(e => e.StartTime).Select(e => new
        {
            calendarEventId = e.CalendarEventId,
            title = e.Title,
            startTime = e.StartTime,
            endTime = e.EndTime,
            isRecurring = e.IsRecurring,
            recurringSeriesId = e.RecurringSeriesId,
            linkedNoteId = (string?)null,
            hasNextOccurrenceNote = false
        });

        return Results.Ok(new { meetings });
    }
}
