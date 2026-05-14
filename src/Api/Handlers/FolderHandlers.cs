using Api.Contracts;
using Domain.Folders;
using EventStore.Projections;
using Microsoft.AspNetCore.Http;

namespace Api.Handlers;

public static class FolderHandlers
{
    public static async Task<IResult> CreateFolder(CreateFolderRequest req, FolderCommandHandler handler, CancellationToken ct)
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

    public static async Task<IResult> GetFolders(IFolderTreeStore store, CancellationToken ct)
    {
        var all = await store.GetAllAsync(ct).ConfigureAwait(false);
        var tree = BuildTree(all, null);
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
