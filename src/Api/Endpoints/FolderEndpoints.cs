using Api.Handlers;

namespace Api.Endpoints;

public static class FolderEndpoints
{
    public static WebApplication MapFolderEndpoints(this WebApplication app)
    {
        app.MapPost("/folders", FolderHandlers.CreateFolder).RequireAuthorization();
        app.MapGet("/folders", FolderHandlers.GetFolders).RequireAuthorization();
        app.MapPatch("/folders/{folderId}/name", FolderHandlers.RenameFolder).RequireAuthorization();
        app.MapDelete("/folders/{folderId}", FolderHandlers.DeleteFolder).RequireAuthorization();
        app.MapPut("/folders/{folderId}/parent", FolderHandlers.MoveFolder).RequireAuthorization();

        return app;
    }
}
