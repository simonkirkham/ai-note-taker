using Domain.Notes;
using Api.Auth;
using Api.CommandHandlers;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// 38-B: import a pasted transcript INTO an existing note — replace its transcript and re-analyse, in
// one server-side flow. Reuses the recorded-note path (CompleteTranscription → analysis); no new
// event/command. Runs in HTTP scope, persisting with the caller's identity via the scoped overload.
public sealed class TranscriptImportService(
    INoteCommandHandler noteHandler,
    INoteAnalysisService analysis,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    ILogger<TranscriptImportService> logger) : ITranscriptImportService
{
    public async Task<TranscriptImportResult> ImportIntoNoteAsync(NoteId noteId, string transcriptText, CancellationToken ct = default)
    {
        // CompleteTranscription REPLACES the note's transcript (a recording's transcript included —
        // the frontend confirms the replace). The scoped overload authorizes ownership from the
        // event stream and throws NoteNotFoundException (→ 404) for a missing/non-owned note.
        // DurationSeconds is 0 — a pasted transcript has no recorded audio.
        await noteHandler.HandleAsync(new CompleteTranscription(noteId, transcriptText, 0), ct);

        // Analyse the supplied text directly (transcriptOverride) — the transcript was just appended
        // and the async NoteDetail projection still holds the OLD transcript (or none), so reading it
        // would analyse stale text (BUG-30 class). Content/tags come from the (existing) projection.
        var outcome = await analysis.AnalyseAsync(noteId, currentUser.UserId, currentWorkspace.WorkspaceId,
            currentUser.Name, transcriptOverride: transcriptText, ct);
        if (outcome == AnalysisOutcome.ServiceUnavailable)
            // The transcript is already committed; only the AI pass failed. Keep it (the user can
            // re-analyse) rather than failing the import — never lose the pasted transcript.
            logger.LogWarning("Transcript imported into note {NoteId} but analysis was unavailable", noteId.Value);

        // The token must cover the analysis appends (not just the transcript) so the client's first
        // gated read shows the finished, analysed note.
        var version = await noteHandler.GetCurrentVersionAsync(noteId, ct);
        logger.LogInformation("Imported transcript into note {NoteId}: {Chars} chars, analysis {Outcome}",
            noteId.Value, transcriptText.Length, outcome);
        return new TranscriptImportResult(version, outcome);
    }
}
