using System.Text.Json;
using Domain;
using Domain.Folders;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class FolderCommandHandler(IEventStore store, IFolderTreeStore folderTreeStore)
{
    private const int InitialEventVersion = 1;

    public async Task<FolderId> HandleAsync(CreateFolder cmd, CancellationToken ct = default)
    {
        var streamId = cmd.FolderId.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        var newEvents = Rebuild(history).Handle(cmd);
        await PersistAsync(streamId, history, newEvents, ct).ConfigureAwait(false);
        return cmd.FolderId;
    }

    private async Task PersistAsync(string streamId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, CancellationToken ct)
    {
        var envelopes = ToEnvelopes(streamId, newEvents);
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        await UpdateProjectionAsync(envelopes, ct).ConfigureAwait(false);
    }

    private async Task UpdateProjectionAsync(List<EventEnvelope> envelopes, CancellationToken ct)
    {
        foreach (var envelope in envelopes)
        {
            if (EventDeserializer.Deserialize(envelope) is FolderCreated e)
            {
                await folderTreeStore.UpsertAsync(
                    new FolderTreeView(e.FolderId, e.Name, e.ParentFolderId, envelope.OccurredAt), ct)
                    .ConfigureAwait(false);
            }
        }
    }

    private static Folder Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var folder = new Folder();
        foreach (var e in history)
            folder.Apply(EventDeserializer.Deserialize(e));
        return folder;
    }

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
        events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0, EventType: e.GetType().Name, EventVersion: InitialEventVersion,
            OccurredAt: DateTimeOffset.UtcNow, Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), null, null, null))).ToList();
}
