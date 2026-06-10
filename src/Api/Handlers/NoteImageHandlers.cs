using Amazon.S3;
using Domain.Notes;
using EventStore.Projections;
using Api.Auth;
using Api.Contracts;
using Api.Services;

namespace Api.Handlers;

public static class NoteImageHandlers
{
    static readonly Dictionary<string, string> AllowedContentTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/gif"] = "gif",
        ["image/webp"] = "webp"
    };
    const long MaxImageBytes = 10 * 1024 * 1024;

    public static async Task<IResult> PresignUpload(
        Guid noteId,
        PresignUploadRequest req,
        INoteDetailStore noteDetailStore,
        INoteImageStore imageStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        if (req.ContentType is null || !AllowedContentTypes.TryGetValue(req.ContentType, out var ext))
            return Results.BadRequest(new { error = "unsupported_content_type" });
        if (req.ContentLength <= 0 || req.ContentLength > MaxImageBytes)
            return Results.BadRequest(new { error = "image_too_large" });

        var imageId = Guid.NewGuid().ToString("N");
        var key = $"{NoteImageKeys.Prefix(noteId.ToString())}{imageId}.{ext}";
        try
        {
            var uploadUrl = imageStore.PresignUpload(key, req.ContentType);
            return Results.Ok(new { imageId, key, uploadUrl, contentType = req.ContentType });
        }
        catch (AmazonS3Exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    public static async Task<IResult> ResolveImages(
        Guid noteId,
        ResolveImagesRequest req,
        INoteDetailStore noteDetailStore,
        INoteImageStore imageStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();

        var keys = req.Keys ?? [];
        if (keys.Any(k => !NoteImageKeys.IsUnderNote(k, noteId.ToString())))
            return Results.BadRequest(new { error = "key_outside_note" });

        try
        {
            var urls = keys.ToDictionary(k => k, imageStore.PresignDownload);
            return Results.Ok(new { urls });
        }
        catch (AmazonS3Exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
