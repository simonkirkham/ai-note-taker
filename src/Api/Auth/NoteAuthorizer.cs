using Domain.Notes;
using EventStore;

namespace Api.Auth;

// Strongly-consistent note existence + ownership, read from the EVENT STREAM — not the async
// NoteDetail projection, whose post-create lag made note-scoped operations 404 right after create
// under load (the residual E2E flake; root-caused 2026-06-14). Used by the note-scoped handlers
// (action items, …) that authorize against a note but don't route through NoteCommandHandler's own
// event-stream auth. NoteCommandHandler enforces the same rule inline for note writes.
public interface INoteAuthorizer
{
    Task<bool> OwnsNoteAsync(NoteId noteId, string userId, CancellationToken ct = default);
}

public sealed class NoteAuthorizer(IEventStore store) : INoteAuthorizer
{
    public async Task<bool> OwnsNoteAsync(NoteId noteId, string userId, CancellationToken ct = default)
    {
        var history = await store.ReadAsync(noteId.ToStreamId(), ct).ConfigureAwait(false);
        if (history.Count == 0) return false;                                    // never created
        if (history.Any(e => e.EventType == nameof(NoteDeleted))) return false;  // deleted (no un-delete)
        // The note's owner is the UserId stamped on its first event. A null owner is a legacy
        // pre-Phase-8 single-user note → not enforced (matches NoteCommandHandler).
        var owner = history[0].Metadata.UserId;
        return owner is null || owner == userId;
    }
}
