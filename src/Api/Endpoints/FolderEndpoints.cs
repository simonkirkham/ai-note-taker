using Api.Handlers;
using Microsoft.AspNetCore.Builder;

namespace Api.Endpoints;

public static class FolderEndpoints
{
    public static WebApplication MapFolderEndpoints(this WebApplication app)
    {
        app.MapPost("/folders", FolderHandlers.CreateFolder);
        app.MapGet("/folders", FolderHandlers.GetFolders);

        return app;
    }
}
