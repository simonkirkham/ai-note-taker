using Api.Auth;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using Domain.Folders;
using EventStore.Projections;

namespace Api.Handlers;

public static class FolderHandlers
{
    public static async Task<IResult> CreateFolder(CreateFolderRequest req, IFolderCommandHandler handler, CancellationToken ct)
    {
        var folderId = new FolderId(Guid.NewGuid());
        FolderId? parentFolderId = req.ParentFolderId.HasValue
            ? new FolderId(req.ParentFolderId.Value)
            : null;

        try
        {
            await handler.HandleAsync(new Domain.Folders.CreateFolder(folderId, req.Name, parentFolderId, DateTimeOffset.UtcNow), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        return Results.Created($"/folders/{folderId.Value}", new { folderId = folderId.Value });
    }

    public static async Task<IResult> RenameFolder(Guid folderId, RenameFolderRequest req, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!all.Any(f => f.FolderId == new FolderId(folderId) && f.UserId == currentUser.UserId))
            return Results.NotFound();
        try
        {
            await handler.HandleAsync(new Domain.Folders.RenameFolder(new FolderId(folderId), req.Name), ct);
        }
        catch (FolderNotFoundException)
        {
            return Results.NotFound();
        }
        catch (InvalidOperationException)
        {
            return Results.BadRequest();
        }

        return Results.Ok();
    }

    public static async Task<IResult> DeleteFolder(Guid folderId, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!all.Any(f => f.FolderId == new FolderId(folderId) && f.UserId == currentUser.UserId))
            return Results.NotFound();
        try
        {
            await handler.HandleAsync(new Domain.Folders.DeleteFolder(new FolderId(folderId)), ct);
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound();
        }

        return Results.NoContent();
    }

    public static async Task<IResult> MoveFolder(Guid folderId, MoveFolderRequest req, IFolderCommandHandler handler, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
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

        try
        {
            await handler.HandleAsync(new Domain.Folders.MoveFolder(sourceFolderId, newParentFolderId), ct);
        }
        catch (CycleDetectedException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
        catch (InvalidOperationException)
        {
            return Results.NotFound();
        }

        return Results.Ok();
    }

    public static async Task<IResult> GetFolders(IFolderTreeStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, CancellationToken ct)
    {
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
