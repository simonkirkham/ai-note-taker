using Api.CommandHandlers;

namespace Api.Handlers;

public static class AdminHandlers
{
    public static async Task<IResult> RebuildProjections(IProjectionRebuildHandler handler)
    {
        var count = await handler.RebuildAsync();
        return Results.Ok(new { rebuilt = count });
    }
}
