using Api.Auth;
using Api.Handlers;

namespace Api.Endpoints;

public static class CalendarEndpoints
{
    public static void MapCalendarEndpoints(this WebApplication app)
    {
        // 34-B: calendar reads + meeting-note creation are workspace-scoped — each workspace resolves
        // its own connected calendar. Mounted under `/w/{workspaceId}` (validated like every other
        // scoped route) so `ICurrentWorkspace` resolves the workspace from the prefix.
        var scoped = app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>();
        scoped.MapGet("/calendar/{date}", CalendarHandlers.GetMeetingsForDate).RequireAuthorization();
        scoped.MapPost("/notes/from-meeting", CalendarHandlers.CreateNoteFromMeeting).RequireAuthorization();
        scoped.MapPost("/notes/from-next-occurrence", CalendarHandlers.CreateNoteFromNextOccurrence).RequireAuthorization();
    }
}
