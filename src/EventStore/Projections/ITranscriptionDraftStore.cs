using Domain.Notes;

namespace EventStore.Projections;

// Overwrite-in-place store for in-progress transcription drafts (one item per
// note). Not the event store, not a rebuildable projection — a loss-tolerant
// recovery buffer (ADR 0011). Save overwrites; Delete is idempotent.
public interface ITranscriptionDraftStore
{
    Task SaveAsync(TranscriptionDraft draft, CancellationToken ct = default);
    Task<TranscriptionDraft?> GetAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
}
