using Api.CommandHandlers;
using Api.Contracts;
using Api.Auth;
using Api.Services;
using Domain.Notes;
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

    public static async Task<IResult> CreateNoteFromMeeting(
        CreateNoteFromMeetingRequest req,
        INoteCommandHandler handler,
        ICalendarLinkIndexStore calendarLinkStore,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var existing = await calendarLinkStore.GetByCalendarEventIdAsync(req.CalendarEventId, ct);
        if (existing is not null) return Results.Conflict();

        var noteId = new NoteId(Guid.NewGuid());
        await handler.HandleAsync(new CreateNote(noteId), ct);
        await handler.HandleAsync(new RenameNote(noteId, req.Title), ct);
        await handler.HandleAsync(new SetNoteDate(noteId, DateOnly.FromDateTime(req.StartTime.LocalDateTime)), ct);
        await handler.HandleAsync(new LinkNoteToCalendarEvent(noteId, req.CalendarEventId, req.Title,
            req.StartTime, req.EndTime, req.IsRecurring, req.RecurringSeriesId), ct);

        return Results.Created($"/notes/{noteId.Value}", new { noteId = noteId.Value });
    }
}
