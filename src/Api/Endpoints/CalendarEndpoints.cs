using Api.Handlers;

namespace Api.Endpoints;

public static class CalendarEndpoints
{
    public static void MapCalendarEndpoints(this WebApplication app)
    {
        app.MapGet("/calendar/today", CalendarHandlers.GetTodaysMeetings)
           .RequireAuthorization();
        app.MapPost("/notes/from-meeting", CalendarHandlers.CreateNoteFromMeeting)
           .RequireAuthorization();
    }
}
