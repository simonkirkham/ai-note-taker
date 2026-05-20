using Domain.Notes;
using Domain.Todos;
using EventStore;
using EventStore.Projections;
using Api.EventHandlers;

namespace Api.Projections;

public sealed class TodoListEventHandler(ITodoListStore store) : IDomainEventHandler
{
    public async Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;

        var streamId = events[0].StreamId;

        if (streamId.StartsWith("todo#", StringComparison.Ordinal))
        {
            await HandleTodoStreamAsync(events, ct).ConfigureAwait(false);
            return;
        }

        // Note stream — handle NoteDeleted and NoteRenamed affecting action items
        var noteId = NoteIdFromStreamId(streamId);

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

    private async Task HandleTodoStreamAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct)
    {
        foreach (var envelope in events)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case TodoAdded e:
                    await store.PutAsync(new TodoItem(
                        e.TodoId.Value.ToString(), null, null, "todo",
                        e.Description, envelope.OccurredAt, null,
                        envelope.Metadata.UserId ?? e.UserId), ct).ConfigureAwait(false);
                    break;
                case TodoCompleted e:
                    await store.UpdateCompletedAtAsync(e.TodoId.Value.ToString(), e.CompletedAt, ct).ConfigureAwait(false);
                    break;
                case TodoReopened e:
                    await store.UpdateCompletedAtAsync(e.TodoId.Value.ToString(), null, ct).ConfigureAwait(false);
                    break;
                case TodoDeleted e:
                    await store.DeleteAsync(e.TodoId.Value.ToString(), ct).ConfigureAwait(false);
                    break;
            }
        }
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
