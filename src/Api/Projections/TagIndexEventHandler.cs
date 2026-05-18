using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class TagIndexEventHandler(ITagIndexStore store) : IDomainEventHandler
{
    public async Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;
        var noteId = NoteIdFromStreamId(events[0].StreamId);

        if (events.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            await store.DeleteByNoteAsync(noteId.Value.ToString("N"), ct).ConfigureAwait(false);
            return;
        }

        foreach (var envelope in events)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case NoteTagged e:
                    await store.PutAsync(e.Tag, e.NoteId.Value.ToString("N"), ct).ConfigureAwait(false);
                    break;
                case NoteUntagged e:
                    await store.DeleteAsync(e.Tag, e.NoteId.Value.ToString("N"), ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
        }
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
