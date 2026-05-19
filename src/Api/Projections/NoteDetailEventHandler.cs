using Domain.Notes;
using EventStore;
using EventStore.Projections;

using Api.EventHandlers;
using Api.Exceptions;
namespace Api.Projections;

public sealed class NoteDetailEventHandler(IEventStore eventStore, INoteDetailStore store) : IDomainEventHandler
{
    public async Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;
        var noteId = NoteIdFromStreamId(events[0].StreamId);

        if (events.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            await store.DeleteAsync(noteId, ct).ConfigureAwait(false);
            return;
        }

        var history = await eventStore.ReadAsync(events[0].StreamId, ct).ConfigureAwait(false);
        var projection = new NoteDetailProjection();
        foreach (var e in history) projection.Handle(e);

        var detail = projection.GetDetail(noteId)
            ?? throw new NoteNotFoundException(noteId);
        await store.UpsertAsync(detail, ct).ConfigureAwait(false);
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
