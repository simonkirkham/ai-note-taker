using System.Globalization;
using Api.CommandHandlers;
using Api.Contracts;
using Api.Auth;
using Api.Services;
using Domain.Notes;
using Domain.Workspaces;
using EventStore.Projections;
using Microsoft.Extensions.Logging;

namespace Api.Handlers;

public static class CalendarHandlers
{
    public static async Task<IResult> GetMeetingsForDate(string date, string? tz, ICalendarClient calendar, ICalendarLinkIndexStore calendarLinkStore, ICurrentUser currentUser, ILoggerFactory loggerFactory)
    {
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var selectedDate))
        {
            loggerFactory.CreateLogger(typeof(CalendarHandlers)).LogDebug("Rejected calendar request with malformed date segment {Date}", date);
            return Results.BadRequest(new { error = "invalid_date" });
        }

        if (string.IsNullOrWhiteSpace(tz))
            return Results.BadRequest(new { error = "tz parameter is required" });

        try { TimeZoneInfo.FindSystemTimeZoneById(tz); }
        catch (TimeZoneNotFoundException) { return Results.BadRequest(new { error = "invalid_timezone" }); }

        var events = await calendar.GetEventsForDayAsync(selectedDate, tz);
        if (events is null)
            return Results.Ok(new { error = "calendar_unavailable" });

        var links = await Task.WhenAll(
            events.Select(async e =>
            {
                try { return await calendarLinkStore.GetByCalendarEventIdAsync(e.CalendarEventId); }
                catch { return null; }
            }));
        var linkMap = links
            .Where(l => l is not null && l.UserId == currentUser.UserId)
            .ToDictionary(l => l!.CalendarEventId, l => l!.NoteId);

        var seriesIds = events
            .Where(e => e.IsRecurring && e.RecurringSeriesId is not null)
            .Select(e => e.RecurringSeriesId!)
            .Distinct()
            .ToList();

        var seriesTasks = seriesIds.ToDictionary(
            id => id,
            id => calendarLinkStore.GetByRecurringSeriesIdAsync(id));
        await Task.WhenAll(seriesTasks.Values);

        var nextOccurrenceNoteMap = seriesTasks.ToDictionary(
            kvp => kvp.Key,
            kvp =>
            {
                try
                {
                    var futureLink = kvp.Value.Result.FirstOrDefault(l =>
                        l.UserId == currentUser.UserId &&
                        !linkMap.ContainsKey(l.CalendarEventId) &&
                        l.StartTime > DateTimeOffset.UtcNow);
                    return (HasNote: futureLink is not null, NoteId: futureLink?.NoteId);
                }
                catch { return (HasNote: false, NoteId: (string?)null); }
            });

        var meetings = events.OrderBy(e => e.StartTime).Select(e => new
        {
            calendarEventId = e.CalendarEventId,
            title = e.Title,
            startTime = e.StartTime,
            endTime = e.EndTime,
            isRecurring = e.IsRecurring,
            recurringSeriesId = e.RecurringSeriesId,
            linkedNoteId = linkMap.GetValueOrDefault(e.CalendarEventId),
            hasNextOccurrenceNote = e.RecurringSeriesId is not null &&
                nextOccurrenceNoteMap.GetValueOrDefault(e.RecurringSeriesId).HasNote,
            nextOccurrenceNoteId = e.RecurringSeriesId is not null
                ? nextOccurrenceNoteMap.GetValueOrDefault(e.RecurringSeriesId).NoteId
                : null
        });

        return Results.Ok(new { meetings, provider = calendar.ProviderName });
    }

    public static async Task<IResult> CreateNoteFromMeeting(
        CreateNoteFromMeetingRequest req,
        INoteCommandHandler handler,
        ICalendarLinkIndexStore calendarLinkStore,
        ICurrentUser currentUser,
        ICurrentWorkspace currentWorkspace,
        CancellationToken ct)
    {
        var existing = await calendarLinkStore.GetByCalendarEventIdAsync(req.CalendarEventId, ct);
        if (existing is not null && existing.UserId == currentUser.UserId) return Results.Conflict();

        var noteId = new NoteId(Guid.NewGuid());
        await handler.HandleAsync(new CreateNote(noteId, new WorkspaceId(currentWorkspace.WorkspaceId)), ct);
        await handler.HandleAsync(new RenameNote(noteId, req.Title), ct);
        await handler.HandleAsync(new SetNoteDate(noteId, DateOnly.FromDateTime(req.StartTime.LocalDateTime)), ct);
        await handler.HandleAsync(new LinkNoteToCalendarEvent(noteId, req.CalendarEventId, req.Title,
            req.StartTime, req.EndTime, req.IsRecurring, req.RecurringSeriesId), ct);

        return Results.Created($"/notes/{noteId.Value}", new { noteId = noteId.Value });
    }

    public static async Task<IResult> CreateNoteFromNextOccurrence(
        CreateNoteFromNextOccurrenceRequest req,
        ICalendarClient calendar,
        INoteCommandHandler handler,
        ICalendarLinkIndexStore calendarLinkStore,
        ICurrentUser currentUser,
        ICurrentWorkspace currentWorkspace,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.RecurringSeriesId))
            return Results.BadRequest(new { error = "recurring_series_id_required" });

        var next = await calendar.GetNextOccurrenceAsync(req.RecurringSeriesId, DateTimeOffset.UtcNow);
        if (next is null)
            return Results.NotFound(new { error = "no_future_occurrences" });

        var existing = await calendarLinkStore.GetByCalendarEventIdAsync(next.CalendarEventId, ct);
        if (existing is not null && existing.UserId == currentUser.UserId)
            return Results.Ok(new { noteId = existing.NoteId, alreadyExists = true });

        var noteId = new NoteId(Guid.NewGuid());
        await handler.HandleAsync(new CreateNote(noteId, new WorkspaceId(currentWorkspace.WorkspaceId)), ct);
        await handler.HandleAsync(new RenameNote(noteId, next.Title), ct);
        await handler.HandleAsync(new SetNoteDate(noteId, DateOnly.FromDateTime(next.StartTime.LocalDateTime)), ct);
        await handler.HandleAsync(new LinkNoteToCalendarEvent(noteId, next.CalendarEventId, next.Title,
            next.StartTime, next.EndTime, next.IsRecurring, next.RecurringSeriesId), ct);

        return Results.Created($"/notes/{noteId.Value}", new
        {
            noteId = noteId.Value,
            nextOccurrence = new
            {
                calendarEventId = next.CalendarEventId,
                startTime = next.StartTime,
                endTime = next.EndTime
            }
        });
    }
}
