using Api.Auth;
using Api.Consistency;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using Domain.Folders;
using EventStore.Projections;

namespace Api.Handlers;

public static class FolderHandlers
{
    // Read-your-writes (RYW-3b): surface the folder stream's new version as the write token so the
    // client can echo it into If-Consistent-With on its next folder read, making that read wait
    // until the async projector has applied this write.
    private static void SetConsistencyToken(HttpResponse response, FolderId folderId, long version) =>
        response.Headers["X-Consistency-Token"] = $"{folderId.ToStreamId()}@{version}";

    public static async Task<IResult> CreateFolder(CreateFolderRequest req, HttpResponse response, IFolderCommandHandler handler, CancellationToken ct)
    {
        var folderId = new FolderId(Guid.NewGuid());
        FolderId? parentFolderId = req.ParentFolderId.HasValue
            ? new FolderId(req.ParentFolderId.Value)
            : null;

        long version;
        try
        {
            version = await handler.HandleAsync(new Domain.Folders.CreateFolder(folderId, req.Name, parentFolderId, DateTimeOffset.UtcNow), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        SetConsistencyToken(response, folderId, version);
        return Results.Created($"/folders/{folderId.Value}", new { folderId = folderId.Value });
    }

    public static async Task<IResult> RenameFolder(Guid folderId, RenameFolderRequest req, HttpResponse response, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!all.Any(f => f.FolderId == new FolderId(folderId) && f.UserId == currentUser.UserId))
            return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new Domain.Folders.RenameFolder(new FolderId(folderId), req.Name), ct);
        }
        catch (FolderNotFoundException)
        {
            return Results.NotFound();
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        SetConsistencyToken(response, new FolderId(folderId), version);
        return Results.Ok();
    }

    public static async Task<IResult> DeleteFolder(Guid folderId, HttpResponse response, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!all.Any(f => f.FolderId == new FolderId(folderId) && f.UserId == currentUser.UserId))
            return Results.NotFound();
        long version;
        try
        {
            version = await handler.HandleAsync(new Domain.Folders.DeleteFolder(new FolderId(folderId)), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound();
        }

        SetConsistencyToken(response, new FolderId(folderId), version);
        return Results.NoContent();
    }

    public static async Task<IResult> MoveFolder(Guid folderId, MoveFolderRequest req, HttpResponse response, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        var sourceFolderId = new FolderId(folderId);
        if (!all.Any(f => f.FolderId == sourceFolderId && f.UserId == currentUser.UserId))
            return Results.NotFound();

        FolderId? newParentFolderId = req.ParentFolderId.HasValue
            ? new FolderId(req.ParentFolderId.Value)
            : null;

        if (newParentFolderId.HasValue && !all.Any(f => f.FolderId == newParentFolderId && f.UserId == currentUser.UserId))
            return Results.NotFound();

        long version;
        try
        {
            version = await handler.HandleAsync(new Domain.Folders.MoveFolder(sourceFolderId, newParentFolderId), ct);
        }
        catch (CycleDetectedException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound();
        }

        SetConsistencyToken(response, sourceFolderId, version);
        return Results.Ok();
    }

    public static async Task<IResult> GetFolders(IFolderTreeStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IConsistencyGate gate, HttpContext http, CancellationToken ct)
    {
        // Read-your-writes: if the client presents the write token from its last folder write, wait
        // (bounded) until the async projector has applied it before reading. Absent token → no
        // wait. On timeout the read still returns, flagged X-Consistency: stale.
        var consistency = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (consistency.IsStale) http.Response.Headers["X-Consistency"] = "stale";

        var all = await store.GetAllAsync(ct).ConfigureAwait(false);
        var userFolders = all.Where(f => f.UserId == currentUser.UserId && currentWorkspace.Includes(f.WorkspaceId)).ToList();
        var tree = BuildTree(userFolders, null);
        return Results.Ok(new { folders = tree });
    }

    private static List<object> BuildTree(IReadOnlyList<FolderTreeView> all, FolderId? parentId)
    {
        return all
            .Where(f => f.ParentFolderId == parentId)
            .OrderBy(f => f.CreatedAt)
            .Select(f => (object)new
            {
                folderId = f.FolderId.Value,
                name = f.Name,
                createdAt = f.CreatedAt,
                children = BuildTree(all, f.FolderId)
            })
            .ToList();
    }
}
