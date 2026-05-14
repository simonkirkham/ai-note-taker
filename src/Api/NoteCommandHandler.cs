using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class NoteCommandHandler(
    IEventStore store,
    INoteTitleListStore projStore,
    INoteDetailStore noteDetailStore,
    ITodoListStore todoListStore,
    INoteCardListStore noteCardListStore)
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

    public async Task HandleAsync(TagNote cmd, CancellationToken ct = default)
    {
        var streamId = cmd.NoteId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) throw new NoteNotFoundException(cmd.NoteId);
        var newEvents = Rebuild(history).Handle(cmd);
        await PersistAsync(streamId, cmd.NoteId, history, newEvents, ct).ConfigureAwait(false);
    }

    public async Task HandleAsync(UntagNote cmd, CancellationToken ct = default)
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
            var existingCard = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
            if (existingCard is not null)
                await noteCardListStore.UpsertAsync(
                    existingCard with { Deleted = true, LastModifiedAt = newEnvelopes[0].OccurredAt }, ct).ConfigureAwait(false);
            return;
        }

        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        foreach (var e in history) { titleList.Handle(e); detail.Handle(e); }
        foreach (var e in newEnvelopes) { titleList.Handle(e); detail.Handle(e); }

        var item = titleList.GetView().Items.FirstOrDefault(i => i.NoteId == noteId)
            ?? throw new NoteNotFoundException(noteId);
        await projStore.UpsertAsync(item, ct).ConfigureAwait(false);
        var noteDetail = detail.GetDetail(noteId)
            ?? throw new NoteNotFoundException(noteId);
        await noteDetailStore.UpsertAsync(noteDetail, ct).ConfigureAwait(false);

        if (newEnvelopes.Any(e => e.EventType == nameof(NoteRenamed)))
            await todoListStore.UpdateNoteTitleAsync(noteId, item.Title, ct).ConfigureAwait(false);

        var card = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
        await noteCardListStore.UpsertAsync(
            ApplyNoteEventsToCard(card, noteId, newEnvelopes), ct).ConfigureAwait(false);
    }

    private static NoteCardView ApplyNoteEventsToCard(NoteCardView? existing, NoteId noteId, List<EventEnvelope> envelopes)
    {
        var card = existing;
        foreach (var envelope in envelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case NoteCreated:
                    card = new NoteCardView(noteId, string.Empty, string.Empty,
                        Array.Empty<NoteCardActionItem>(), null,
                        envelope.OccurredAt, envelope.OccurredAt, false);
                    break;
                case NoteRenamed e when card is not null:
                    card = card with { Title = e.NewTitle, LastModifiedAt = envelope.OccurredAt };
                    break;
                case ContentEditedV2 e when card is not null:
                    var content = e.NewContent.Length > NoteCardListProjection.MaxStoredContentLength ? e.NewContent[..NoteCardListProjection.MaxStoredContentLength] : e.NewContent;
                    card = card with { Content = content, LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteDateSet e when card is not null:
                    card = card with { Date = e.Date, LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteTagged e when card is not null:
                    card = card with { Tags = (card.Tags ?? []).Append(e.Tag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteUntagged e when card is not null:
                    card = card with { Tags = (card.Tags ?? []).Where(t => t != e.Tag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
                    break;
                default:
                    break;
            }
        }
        return card ?? throw new NoteNotFoundException(noteId);
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
