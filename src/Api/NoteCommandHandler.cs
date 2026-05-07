using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class NoteNotFoundException(NoteId noteId) : Exception($"Note {noteId} not found.");

public sealed class NoteCommandHandler(IEventStore store, INoteTitleListStore projStore, INoteDetailStore noteDetailStore, ITodoListStore todoListStore)
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

    public async Task HandleAsync(EditContent cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new NoteNotFoundException(cmd.NoteId);
        var newEvents = Rebuild(history).Handle(cmd);
        if (newEvents.Count == 0) return;
        await PersistAsync(streamId, cmd.NoteId, history, newEvents, ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(DeleteNote cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new NoteNotFoundException(cmd.NoteId);
        var newEvents = Rebuild(history).Handle(cmd);
        await PersistAsync(streamId, cmd.NoteId, history, newEvents, ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(SetNoteDate cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new NoteNotFoundException(cmd.NoteId);
        var newEvents = Rebuild(history).Handle(cmd);
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
        if (newEnvelopes.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            await projStore.DeleteAsync(noteId, ct).ConfigureAwait(false);
            await noteDetailStore.DeleteAsync(noteId, ct).ConfigureAwait(false);
            await todoListStore.DeleteByNoteAsync(noteId, ct).ConfigureAwait(false);
            return;
        }

        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        foreach (var e in history) { titleList.Handle(e); detail.Handle(e); }
        foreach (var e in newEnvelopes) { titleList.Handle(e); detail.Handle(e); }

        var item = titleList.GetView().Items.First(i => i.NoteId == noteId);
        await projStore.UpsertAsync(item, ct).ConfigureAwait(false);
        await noteDetailStore.UpsertAsync(detail.GetDetail(noteId)!, ct).ConfigureAwait(false);

        if (newEnvelopes.Any(e => e.EventType == nameof(NoteRenamed)))
            await todoListStore.UpdateNoteTitleAsync(noteId, item.Title, ct).ConfigureAwait(false);
    }

    private static Note Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var note = new Note();
        foreach (var e in history)
            note.Apply(EventDeserializer.Deserialize(e));
        return note;
    }

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        events.Select(e =>
        {
            // The domain aggregate emits ContentEdited; the infrastructure layer persists it as ContentEditedV2.
            var (type, version, payload) = e is ContentEdited ce
                ? (nameof(ContentEdited), 2, JsonSerializer.Serialize(
                    new ContentEditedV2(ce.NoteId, ce.NewContent, ce.NewContent.Length)))
                : (e.GetType().Name, InitialEventVersion, JsonSerializer.Serialize(e, e.GetType()));

            return new EventEnvelope(
                StreamId: streamId, SequenceNumber: 0, EventType: type, EventVersion: version,
                OccurredAt: DateTimeOffset.UtcNow, Payload: payload,
                Metadata: new EventMetadata(Guid.NewGuid(), null, null, null));
        }).ToList();
}
