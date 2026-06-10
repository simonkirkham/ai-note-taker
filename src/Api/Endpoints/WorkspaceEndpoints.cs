using Api.Handlers;

namespace Api.Endpoints;

public static class WorkspaceEndpoints
{
    public static WebApplication MapWorkspaceEndpoints(this WebApplication app)
    {
        app.MapGet("/workspaces", WorkspaceHandlers.GetWorkspaces).RequireAuthorization();
        app.MapPost("/workspaces", WorkspaceHandlers.CreateWorkspace).RequireAuthorization();
        app.MapPatch("/workspaces/{workspaceId}", WorkspaceHandlers.RenameWorkspace).RequireAuthorization();
        app.MapDelete("/workspaces/{workspaceId}", WorkspaceHandlers.DeleteWorkspace).RequireAuthorization();

        return app;
    }
}
