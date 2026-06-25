using Api.Auth;
using Api.Consistency;
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

    // Read-your-writes (RYW-3b): surface the workspace stream's new version as the write token so
    // the client can echo it into If-Consistent-With on its next workspace read.
    private static void SetConsistencyToken(HttpResponse response, WorkspaceId workspaceId, long version) =>
        response.Headers["X-Consistency-Token"] = $"{workspaceId.ToStreamId()}@{version}";

    public static async Task<IResult> GetWorkspaces(IWorkspaceListStore store, ICurrentUser currentUser, IConsistencyGate gate, HttpContext http, CancellationToken ct)
    {
        // Read-your-writes: if the client presents the write token from its last workspace write,
        // wait (bounded) until the async projector has applied it. On timeout, flagged stale.
        var consistency = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (consistency.IsStale) http.Response.Headers["X-Consistency"] = "stale";

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

    public static async Task<IResult> CreateWorkspace(CreateWorkspaceRequest req, HttpResponse response, IWorkspaceCommandHandler handler, CancellationToken ct)
    {
        var workspaceId = new WorkspaceId(Guid.NewGuid().ToString("N"));
        long version;
        try
        {
            version = await handler.HandleAsync(new CreateWorkspace(workspaceId, req.Name), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        SetConsistencyToken(response, workspaceId, version);
        return Results.Created($"/workspaces/{workspaceId.Value}", new { workspaceId = workspaceId.Value });
    }

    public static async Task<IResult> RenameWorkspace(string workspaceId, RenameWorkspaceRequest req, HttpResponse response, IWorkspaceCommandHandler handler, IWorkspaceListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var id = new WorkspaceId(workspaceId);
        if (!await OwnsAsync(store, currentUser, id, ct).ConfigureAwait(false))
            return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new RenameWorkspace(id, req.Name), ct);
        }
        catch (WorkspaceNotFoundException)
        {
            return Results.NotFound();
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        SetConsistencyToken(response, id, version);
        return Results.Ok();
    }

    public static async Task<IResult> DeleteWorkspace(string workspaceId, HttpResponse response, IWorkspaceCommandHandler handler, IWorkspaceListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var id = new WorkspaceId(workspaceId);
        if (id.IsDefault)
            return Results.Conflict(new { error = "The default workspace cannot be deleted." });
        if (!await OwnsAsync(store, currentUser, id, ct).ConfigureAwait(false))
            return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new DeleteWorkspace(id), ct);
        }
        catch (DefaultWorkspaceUndeletableException)
        {
            return Results.Conflict(new { error = "The default workspace cannot be deleted." });
        }
        catch (WorkspaceNotEmptyException)
        {
            return Results.Conflict(new { error = "Workspace is not empty." });
        }
        catch (WorkspaceNotFoundException)
        {
            return Results.NotFound();
        }

        SetConsistencyToken(response, id, version);
        return Results.NoContent();
    }

    private static async Task<bool> OwnsAsync(IWorkspaceListStore store, ICurrentUser currentUser, WorkspaceId id, CancellationToken ct)
    {
        var all = await store.GetAllAsync(ct).ConfigureAwait(false);
        return all.Any(w => w.WorkspaceId == id && w.UserId == currentUser.UserId);
    }
}
