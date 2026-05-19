using Domain.Notes;
using EventStore;
using EventStore.Projections;

using Api.EventHandlers;
using Api.Exceptions;
namespace Api.Projections;

public sealed class NoteTitleListEventHandler(IEventStore eventStore, INoteTitleListStore store) : IDomainEventHandler
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
        var projection = new NoteTitleListProjection();
        foreach (var e in history) projection.Handle(e);

        var item = projection.GetView().Items.FirstOrDefault(i => i.NoteId == noteId)
            ?? throw new NoteNotFoundException(noteId);
        await store.UpsertAsync(item, ct).ConfigureAwait(false);
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
