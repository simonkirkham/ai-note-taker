using Api.Auth;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using Domain.Workspaces;
using EventStore.Projections;

namespace Api.Handlers;

public static class WorkspaceHandlers
{
    // Synthesised name for the reserved default workspace. The default is never
    // persisted — it is materialised at read time for every user (decision #4).
    private const string DefaultWorkspaceName = "Personal";

    public static async Task<IResult> GetWorkspaces(IWorkspaceListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await store.GetAllAsync(ct).ConfigureAwait(false);
        var mine = all.Where(w => w.UserId == currentUser.UserId)
            .OrderBy(w => w.CreatedAt)
            .ToList();

        if (!mine.Any(w => w.WorkspaceId.IsDefault))
            mine.Insert(0, new WorkspaceListView(WorkspaceId.Default, DefaultWorkspaceName, DateTimeOffset.MinValue, currentUser.UserId));

        var workspaces = mine.Select(w => new
        {
            workspaceId = w.WorkspaceId.Value,
            name = w.Name,
            isDefault = w.WorkspaceId.IsDefault
        });
        return Results.Ok(new { workspaces });
    }

    public static async Task<IResult> CreateWorkspace(CreateWorkspaceRequest req, IWorkspaceCommandHandler handler, CancellationToken ct)
    {
        var workspaceId = new WorkspaceId(Guid.NewGuid().ToString("N"));
        try
        {
            await handler.HandleAsync(new CreateWorkspace(workspaceId, req.Name, DateTimeOffset.UtcNow), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        return Results.Created($"/workspaces/{workspaceId.Value}", new { workspaceId = workspaceId.Value });
    }

    public static async Task<IResult> RenameWorkspace(string workspaceId, RenameWorkspaceRequest req, IWorkspaceCommandHandler handler, IWorkspaceListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var id = new WorkspaceId(workspaceId);
        if (!await OwnsAsync(store, currentUser, id, ct).ConfigureAwait(false))
            return Results.NotFound();
        try
        {
            await handler.HandleAsync(new RenameWorkspace(id, req.Name), ct);
        }
        catch (WorkspaceNotFoundException)
        {
            return Results.NotFound();
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        return Results.Ok();
    }

    public static async Task<IResult> DeleteWorkspace(string workspaceId, IWorkspaceCommandHandler handler, IWorkspaceListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var id = new WorkspaceId(workspaceId);
        if (id.IsDefault)
            return Results.Conflict(new { error = "The default workspace cannot be deleted." });
        if (!await OwnsAsync(store, currentUser, id, ct).ConfigureAwait(false))
            return Results.NotFound();
        try
        {
            await handler.HandleAsync(new DeleteWorkspace(id), ct);
        }
        catch (DefaultWorkspaceUndeletableException)
        {
            return Results.Conflict(new { error = "The default workspace cannot be deleted." });
        }
        catch (WorkspaceNotFoundException)
        {
            return Results.NotFound();
        }

        return Results.NoContent();
    }

    private static async Task<bool> OwnsAsync(IWorkspaceListStore store, ICurrentUser currentUser, WorkspaceId id, CancellationToken ct)
    {
        var all = await store.GetAllAsync(ct).ConfigureAwait(false);
        return all.Any(w => w.WorkspaceId == id && w.UserId == currentUser.UserId);
    }
}
