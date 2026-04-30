using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class NoteNotFoundException(NoteId noteId) : Exception($"Note {noteId} not found.");

public sealed class NoteCommandHandler(IEventStore store, NoteTitleListStore projStore)
{
    private const int InitialEventVersion = 1;

    public async Task<NoteId> HandleAsync(CreateNote cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = Rebuild(history).Handle(cmd);
        await PersistAsync(streamId, cmd.NoteId, history, newEvents, ct).ConfigureAwait(false);
        return cmd.NoteId;
    }

    public async Task HandleAsync(RenameNote cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new NoteNotFoundException(cmd.NoteId);
        var newEvents = Rebuild(history).Handle(cmd);
        if (newEvents.Count == 0) return;
        await PersistAsync(streamId, cmd.NoteId, history, newEvents, ct).ConfigureAwait(false);
    }

    private async Task PersistAsync(string streamId, NoteId noteId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, CancellationToken ct)
    {
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        await UpdateProjectionAsync(noteId, history, envelopes, ct).ConfigureAwait(false);
    }

    private async Task UpdateProjectionAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        var projection = new NoteTitleListProjection();
        foreach (var e in history) projection.Handle(e);
        foreach (var e in newEnvelopes) projection.Handle(e);
        var item = projection.GetView().Items.First(i => i.NoteId == noteId);
        await projStore.UpsertAsync(item, ct).ConfigureAwait(false);
    }

    private static Note Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var note = new Note();
        foreach (var e in history)
            note.Apply(EventDeserializer.Deserialize(e));
        return note;
    }

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0, EventType: e.GetType().Name, EventVersion: InitialEventVersion,
            OccurredAt: DateTimeOffset.UtcNow,
            Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), null, null, null)
        )).ToList();
}
