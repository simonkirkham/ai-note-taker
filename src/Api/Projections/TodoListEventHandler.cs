using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class TodoListEventHandler(ITodoListStore store) : IDomainEventHandler
{
    public async Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;
        var noteId = NoteIdFromStreamId(events[0].StreamId);

        if (events.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            await store.DeleteByNoteAsync(noteId, ct).ConfigureAwait(false);
            return;
        }

        foreach (var envelope in events)
        {
            if (EventDeserializer.Deserialize(envelope) is NoteRenamed e)
                await store.UpdateNoteTitleAsync(noteId, e.NewTitle, ct).ConfigureAwait(false);
        }
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
