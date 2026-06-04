using Api.Handlers;

namespace Api.Endpoints;

public static class CalendarEndpoints
{
    public static void MapCalendarEndpoints(this WebApplication app)
    {
        app.MapGet("/calendar/{date}", CalendarHandlers.GetMeetingsForDate)
           .RequireAuthorization();
        app.MapPost("/notes/from-meeting", CalendarHandlers.CreateNoteFromMeeting)
           .RequireAuthorization();
        app.MapPost("/notes/from-next-occurrence", CalendarHandlers.CreateNoteFromNextOccurrence)
           .RequireAuthorization();
    }
}
