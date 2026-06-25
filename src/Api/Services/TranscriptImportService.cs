using Domain.Notes;
using Domain.Workspaces;
using Api.Auth;
using Api.CommandHandlers;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Reuses the recorded-note events minus audio (NoteCreated → TranscriptionCompleted → analysis);
// no new event or command. Runs in HTTP scope so it persists with the caller's identity (the
// scoped command-handler overload stamps the owner name on NoteCreated, exactly like a recording).
public sealed class TranscriptImportService(
    INoteCommandHandler noteHandler,
    INoteAnalysisService analysis,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    ILogger<TranscriptImportService> logger) : ITranscriptImportService
{
    public async Task<TranscriptImportResult> ImportAsync(string transcriptText, CancellationToken ct = default)
    {
        var noteId = new NoteId(Guid.NewGuid());
        var workspaceId = currentWorkspace.WorkspaceId;

        // The scoped overload stamps the owner name + workspace metadata on the events, so an
        // imported note is indistinguishable from a recorded one downstream. DurationSeconds is 0 —
        // a pasted transcript has no recorded audio.
        await noteHandler.HandleAsync(new CreateNote(noteId, new WorkspaceId(workspaceId)), ct);
        await noteHandler.HandleAsync(new CompleteTranscription(noteId, transcriptText, 0), ct);

        // Analyse the supplied text directly (transcriptOverride) — the async NoteDetail projection
        // does not exist for a note created microseconds ago, so reading it would 422 (BUG-30 class).
        var outcome = await analysis.AnalyseAsync(noteId, currentUser.UserId, workspaceId,
            currentUser.Name, transcriptOverride: transcriptText, ct);
        if (outcome == AnalysisOutcome.ServiceUnavailable)
            // The transcript is already committed; only the AI pass failed. Keep the note (the user
            // can re-analyse) rather than failing the import — never lose the pasted transcript.
            logger.LogWarning("Imported transcript note {NoteId} saved but analysis was unavailable", noteId.Value);

        // The token must cover the analysis appends (not just the transcript) so the client's first
        // gated read shows the finished, analysed note.
        var version = await noteHandler.GetCurrentVersionAsync(noteId, ct);
        logger.LogInformation("Imported transcript note {NoteId}: {Chars} chars, analysis {Outcome}",
            noteId.Value, transcriptText.Length, outcome);
        return new TranscriptImportResult(noteId.Value, version, outcome);
    }
}
