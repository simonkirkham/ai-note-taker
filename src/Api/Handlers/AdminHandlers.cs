using Microsoft.AspNetCore.Http;

namespace Api.Handlers;

public static class AdminHandlers
{
    public static async Task<IResult> RebuildProjections(ProjectionRebuildHandler handler)
    {
        var count = await handler.RebuildAsync();
        return Results.Ok(new { rebuilt = count });
    }
}
