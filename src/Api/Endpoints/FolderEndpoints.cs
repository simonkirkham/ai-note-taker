using Api.Auth;
using Api.Handlers;

namespace Api.Endpoints;

public static class FolderEndpoints
{
    public static WebApplication MapFolderEndpoints(this WebApplication app)
    {
        // Workspace-scoped under `/w/{workspaceId}` only; the group validates ownership
        // before the handler. The rootless fallback was removed in 23-G.
        MapFolderRoutes(app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>());

        return app;
    }

    private static void MapFolderRoutes(IEndpointRouteBuilder routes)
    {
        routes.MapPost("/folders", FolderHandlers.CreateFolder).RequireAuthorization();
        routes.MapGet("/folders", FolderHandlers.GetFolders).RequireAuthorization();
        routes.MapPatch("/folders/{folderId}/name", FolderHandlers.RenameFolder).RequireAuthorization();
        routes.MapDelete("/folders/{folderId}", FolderHandlers.DeleteFolder).RequireAuthorization();
        routes.MapPut("/folders/{folderId}/parent", FolderHandlers.MoveFolder).RequireAuthorization();
    }
}
