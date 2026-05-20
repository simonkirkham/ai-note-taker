using Api.Services;
using EventStore.Projections;

namespace Api.Handlers;

public static class CalendarHandlers
{
    public static async Task<IResult> GetTodaysMeetings(string? tz, IGoogleCalendarClient calendar, ICalendarLinkIndexStore calendarLinkStore)
    {
        if (string.IsNullOrWhiteSpace(tz))
            return Results.BadRequest(new { error = "tz parameter is required" });

        try { TimeZoneInfo.FindSystemTimeZoneById(tz); }
        catch (TimeZoneNotFoundException) { return Results.BadRequest(new { error = "invalid_timezone" }); }

        var events = await calendar.GetTodaysEventsAsync(tz);
        if (events is null)
            return Results.Ok(new { error = "calendar_unavailable" });

        var links = await Task.WhenAll(
            events.Select(async e =>
            {
                try { return await calendarLinkStore.GetByCalendarEventIdAsync(e.CalendarEventId); }
                catch { return null; }
            }));
        var linkMap = links
            .Where(l => l is not null)
            .ToDictionary(l => l!.CalendarEventId, l => l!.NoteId);

        var meetings = events.OrderBy(e => e.StartTime).Select(e => new
        {
            calendarEventId = e.CalendarEventId,
            title = e.Title,
            startTime = e.StartTime,
            endTime = e.EndTime,
            isRecurring = e.IsRecurring,
            recurringSeriesId = e.RecurringSeriesId,
            linkedNoteId = linkMap.GetValueOrDefault(e.CalendarEventId),
            hasNextOccurrenceNote = false
        });

        return Results.Ok(new { meetings });
    }
}
