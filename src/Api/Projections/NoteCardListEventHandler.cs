using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class NoteCardListEventHandler(INoteCardListStore store) : IDomainEventHandler
{
    public async Task HandleAsync(IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
    {
        if (events.Count == 0) return;
        var noteId = NoteIdFromStreamId(events[0].StreamId);

        if (events.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            var existing = await store.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
            if (existing is not null)
                await store.UpsertAsync(
                    existing with { Deleted = true, LastModifiedAt = events[0].OccurredAt }, ct).ConfigureAwait(false);
            return;
        }

        var card = await store.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
        await store.UpsertAsync(ApplyEventsToCard(card, noteId, events), ct).ConfigureAwait(false);
    }

    private static NoteCardView ApplyEventsToCard(NoteCardView? existing, NoteId noteId, IReadOnlyList<EventEnvelope> envelopes)
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
                    var content = e.NewContent.Length > NoteCardListProjection.MaxStoredContentLength
                        ? e.NewContent[..NoteCardListProjection.MaxStoredContentLength]
                        : e.NewContent;
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
                case NoteFiledInFolder e when card is not null:
                    card = card with { FolderId = e.FolderId, LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteUnfiled when card is not null:
                    card = card with { FolderId = null, LastModifiedAt = envelope.OccurredAt };
                    break;
                default:
                    break;
            }
        }
        return card ?? throw new NoteNotFoundException(noteId);
    }

    private static NoteId NoteIdFromStreamId(string streamId) =>
        new(Guid.Parse(streamId.Split('#')[1]));
}
