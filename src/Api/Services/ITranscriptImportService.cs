using Domain.Notes;

namespace Api.Services;

// 38-B: import a pasted transcript into an EXISTING note (replace its transcript + re-analyse) in ONE
// server-side flow on the Command Lambda, so the analyse step feeds Bedrock the supplied text via
// transcriptOverride instead of reading the just-replaced (still-lagging) async NoteDetail projection.
public interface ITranscriptImportService
{
    Task<TranscriptImportResult> ImportIntoNoteAsync(NoteId noteId, string transcriptText, CancellationToken ct = default);
}

// The post-analysis stream Version (the consistency token) and the analysis Outcome (Analysed, or
// ServiceUnavailable when Bedrock failed but the transcript was kept).
public readonly record struct TranscriptImportResult(long Version, AnalysisOutcome Analysis);
