using Domain;
using Domain.Notes;
using EventStore;

namespace Api.Projections;

// The single seam through which every command handler writes its read models inline,
// after appending. Each method applies a freshly-appended event batch to the projections
// that batch affects. Apply-once output is identical to the bespoke inline logic the
// handlers used to carry; the naturally-idempotent and made-idempotent paths also tolerate
// a redelivered batch (the seam the async projector reuses in 27-B).
public interface IProjectionUpdater
{
    Task ApplyNoteEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct);

    Task ApplyActionItemEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct);

    Task ApplyTodoEventsAsync(IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct);

    Task ApplyFolderEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct);

    Task ApplyWorkspaceEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct);
}
