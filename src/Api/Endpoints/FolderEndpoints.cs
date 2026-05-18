using Api.Handlers;

namespace Api.Endpoints;

public static class FolderEndpoints
{
    public static WebApplication MapFolderEndpoints(this WebApplication app)
    {
        app.MapPost("/folders", FolderHandlers.CreateFolder);
        app.MapGet("/folders", FolderHandlers.GetFolders);
        app.MapPatch("/folders/{folderId}/name", FolderHandlers.RenameFolder);
        app.MapDelete("/folders/{folderId}", FolderHandlers.DeleteFolder);
        app.MapPut("/folders/{folderId}/parent", FolderHandlers.MoveFolder);

        return app;
    }
}
