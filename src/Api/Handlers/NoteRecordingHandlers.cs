using Amazon.S3;
using Amazon.TranscribeService;
using Domain.Notes;
using EventStore.Projections;
using Api.Auth;
using Api.CommandHandlers;
using Api.Contracts;
using Api.Exceptions;
using Api.Services;

namespace Api.Handlers;

public static class NoteRecordingHandlers
{
    const string WavContentType = "audio/wav";
    // Advisory only: a presigned PUT does not bind object size (same caveat as note images).
    // Adequate here — the note owner is the only caller and the bucket expires objects after 7 days.
    const long MaxRecordingBytes = 500L * 1024 * 1024;

    public static async Task<IResult> PresignUpload(
        Guid noteId,
        PresignUploadRequest req,
        INoteDetailStore noteDetailStore,
        INoteRecordingStore recordingStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        if (!string.Equals(req.ContentType, WavContentType, StringComparison.OrdinalIgnoreCase))
            return Results.BadRequest(new { error = "unsupported_content_type" });
        if (req.ContentLength <= 0)
            return Results.BadRequest(new { error = "invalid_content_length" });
        if (req.ContentLength > MaxRecordingBytes)
            return Results.BadRequest(new { error = "recording_too_large" });

        var key = $"{NoteRecordingKeys.Prefix(noteId.ToString())}{Guid.NewGuid():N}.wav";
        try
        {
            var uploadUrl = recordingStore.PresignUpload(key, WavContentType);
            return Results.Ok(new RecordingPresignUploadResponse(key, uploadUrl, WavContentType));
        }
        catch (AmazonS3Exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    public static async Task<IResult> SaveRecording(
        Guid noteId,
        SaveRecordingRequest req,
        HttpResponse response,
        INoteCommandHandler handler,
        ICurrentUser currentUser)
    {
        // Key namespace is the ownership boundary: a save may only reference a key under
        // this note's recordings/ prefix. Ownership itself is authorized from the event
        // stream inside the command handler (never the async projection — RYW/authz guardrail).
        if (string.IsNullOrWhiteSpace(req.Key) || !NoteRecordingKeys.IsUnderNote(req.Key, noteId.ToString()))
            return Results.BadRequest(new { error = "key_outside_note" });

        long version;
        try { version = await handler.HandleAsync(new SaveRecording(new NoteId(noteId), req.Key)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        response.Headers["X-Consistency-Token"] = $"{new NoteId(noteId).ToStreamId()}@{version}";
        return Results.NoContent();
    }

    public static async Task<IResult> Diarize(
        Guid noteId,
        DiarizeRequest req,
        INoteAuthorizer authorizer,
        ITranscriptionJobStarter jobStarter,
        ICurrentUser currentUser)
    {
        // Same ownership boundary as SaveRecording: the key must live under this note's
        // recordings/ prefix, and ownership is authorized from the EVENT STREAM (never the async
        // projection — RYW/authz guardrail), since the completion handler will append a diarized
        // transcript event on the back of this job.
        if (string.IsNullOrWhiteSpace(req.Key) || !NoteRecordingKeys.IsUnderNote(req.Key, noteId.ToString()))
            return Results.BadRequest(new { error = "key_outside_note" });
        if (!await authorizer.OwnsNoteAsync(new NoteId(noteId), currentUser.UserId))
            return Results.NotFound();

        var jobName = DiarizationJobNames.For(noteId.ToString());
        try
        {
            await jobStarter.StartAsync(jobName, req.Key);
            return Results.Accepted();
        }
        catch (AmazonTranscribeServiceException)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }

    public static async Task<IResult> PresignDownload(
        Guid noteId,
        INoteDetailStore noteDetailStore,
        INoteRecordingStore recordingStore,
        ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        if (string.IsNullOrEmpty(detail.RecordingAudioKey)) return Results.NotFound();

        try
        {
            var downloadUrl = recordingStore.PresignDownload(detail.RecordingAudioKey);
            return Results.Ok(new RecordingPresignDownloadResponse(downloadUrl));
        }
        catch (AmazonS3Exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable);
        }
    }
}
