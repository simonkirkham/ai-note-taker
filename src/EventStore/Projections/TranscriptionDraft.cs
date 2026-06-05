using Domain.Notes;

namespace EventStore.Projections;

// Working state, NOT a projection and NOT an event (see ADR 0011). An interim
// snapshot of an in-progress transcript, autosaved every few seconds and
// overwritten in place. Loss-tolerant: the authoritative transcript is the
// TranscriptionCompleted event; this only exists to recover an interrupted
// recording. Self-reaps via the store's TTL.
public record TranscriptionDraft(
    NoteId NoteId,
    string UserId,
    string Text,
    int DurationSeconds,
    DateTimeOffset CapturedAt);
