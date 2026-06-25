namespace Api.Services;

// Phase 38: create a note from a pasted transcript and analyse it in ONE server-side flow on the
// Command Lambda, so the analyse step never races the async NoteDetail projection — it feeds Bedrock
// the supplied text via transcriptOverride instead of reading the (not-yet-built) projection.
public interface ITranscriptImportService
{
    Task<TranscriptImportResult> ImportAsync(string transcriptText, CancellationToken ct = default);
}

// NoteId of the created note, the post-analysis stream Version (the consistency token), and the
// analysis Outcome (Analysed, or ServiceUnavailable when Bedrock failed but the note was kept).
public readonly record struct TranscriptImportResult(Guid NoteId, long Version, AnalysisOutcome Analysis);
