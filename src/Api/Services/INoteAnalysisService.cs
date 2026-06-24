using Domain.Notes;

namespace Api.Services;

// The outcome of an analysis run, mapped to HTTP status by the /analyse endpoint wrapper and
// logged by the non-HTTP caller (the TranscribeCompletion Lambda).
public enum AnalysisOutcome
{
    Analysed,            // 204 — summary/tags/actions recorded
    NothingToAnalyse,    // 422 — no transcript, content, or /ai instruction to work with
    ServiceUnavailable   // 503 — Bedrock failed; nothing recorded, transcript untouched
}

// The note-analysis flow (Bedrock → record summary/tags/actions/instruction-responses), callable
// WITHOUT HTTP scope (33-B2). Owner/workspace are passed explicitly so the TranscribeCompletion
// Lambda can re-analyse on the diarized transcript; the HTTP /analyse endpoint is a thin wrapper.
public interface INoteAnalysisService
{
    // transcriptOverride: when set, analyse this text instead of the note's stored transcript — the
    // Lambda passes the diarized text it just appended (the async projection still lags, so reading
    // the stored transcript would get the stale streamed one). null → use the stored transcript.
    Task<AnalysisOutcome> AnalyseAsync(NoteId noteId, string userId, string? workspaceId,
        string userName, string? transcriptOverride, CancellationToken ct = default);
}
