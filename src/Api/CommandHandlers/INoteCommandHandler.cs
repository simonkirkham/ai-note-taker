using Domain.Notes;

namespace Api.CommandHandlers;

public interface INoteCommandHandler
{
    // Returns the note stream's new version (the RYW write token): the read side waits on
    // proj-position until the async projector reaches it before answering. The caller already
    // holds the NoteId (it is passed into the command), so only the version is surfaced — the
    // same shape as ITodoCommandHandler since RYW-1.
    Task<long> HandleAsync(NoteCommand cmd, CancellationToken ct = default);

    // Identity-explicit overload (33-B2) for non-HTTP callers (the TranscribeCompletion Lambda's
    // analysis re-run) that have no scoped ICurrentUser/ICurrentWorkspace — owner/workspace are
    // passed in (read from the note's history[0].Metadata). The HTTP overload delegates to this.
    Task<long> HandleAsync(NoteCommand cmd, string userId, string? workspaceId, CancellationToken ct = default);

    // The note stream's current version, with NO append (a read). Used to surface a consistency
    // token after a flow that appends across several handler calls — the Phase 38 transcript import
    // appends create + transcript + analysis events, then reads the final version here so the
    // client's first gated read waits for the whole analysed note, not just the transcript.
    Task<long> GetCurrentVersionAsync(NoteId noteId, CancellationToken ct = default);
}
