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
    const int MaxResolveKeys = 100;

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
        if (req.ContentLength <= 0)
            return Results.BadRequest(new { error = "invalid_content_length" });
        // Advisory guard only: a presigned PUT does not bind object size, so this rejects
        // an oversized *declared* length but cannot stop a hostile client from PUTting more.
        // Hard enforcement needs a POST policy (no .NET SDK generator) or an S3 object-size
        // check — tracked as a follow-up. Adequate here: the note owner is the only caller.
        if (req.ContentLength > MaxImageBytes)
            return Results.BadRequest(new { error = "image_too_large" });

        var imageId = Guid.NewGuid().ToString("N");
        var key = $"{NoteImageKeys.Prefix(noteId.ToString())}{imageId}.{ext}";
        try
        {
            var uploadUrl = imageStore.PresignUpload(key, req.ContentType);
            return Results.Ok(new PresignUploadResponse(imageId, key, uploadUrl, req.ContentType));
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

        var keys = (req.Keys ?? []).Distinct().ToList();
        if (keys.Count > MaxResolveKeys)
            return Results.BadRequest(new { error = "too_many_keys" });
        if (keys.Any(k => !NoteImageKeys.IsUnderNote(k, noteId.ToString())))
            return Results.BadRequest(new { error = "key_outside_note" });

        try
        {
            // Presigning is unconditional and cheap: a key with no object in S3 still gets a
            // URL that 404s on GET. 25-B treats a broken image as "not yet uploaded".
            var urls = keys.ToDictionary(k => k, imageStore.PresignDownload);
            return Results.Ok(new ResolveImagesResponse(urls));
        }
        catch (AmazonS3Exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
