using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Observability;

namespace Api.CommandHandlers;

public sealed class NoteCommandHandler(
    IEventStore store,
    INoteTitleListStore noteTitleStore,
    INoteDetailStore noteDetailStore,
    ITodoListStore todoListStore,
    INoteCardListStore noteCardListStore,
    ITagIndexStore tagIndexStore,
    ITagFeedbackStore tagFeedbackStore,
    IActionItemFeedbackStore actionItemFeedbackStore,
    ICalendarLinkIndexStore calendarLinkIndexStore,
    INoteSearchViewStore noteSearchViewStore,
    ICurrentUser currentUser,
    ICurrentWorkspace currentWorkspace,
    IDomainMetrics metrics,
    ILogger<NoteCommandHandler> logger) : INoteCommandHandler
{
    private const int InitialEventVersion = 1;

    // A benign concurrency race (two fast writes to the same note stream, e.g. a
    // space-separated multi-tag paste) makes the second append lose the optimistic-
    // concurrency check. The aggregate is pure and these commands are idempotent on a
    // fresh version (TagNote 409s a duplicate, UntagNote 404s a missing tag), so re-read,
    // re-run, re-append resolves the race transparently instead of dropping the write
    // (BUG-17). A persistent conflict still surfaces after the bounded attempts (→ 409).
    private const int MaxAppendAttempts = 4;
    private static readonly TimeSpan AppendRetryBaseDelay = TimeSpan.FromMilliseconds(20);

    public Task<NoteId> HandleAsync(NoteCommand cmd, CancellationToken ct = default) =>
        CommandInstrumentation.RunAsync(metrics, logger, cmd.GetType().Name, "Note", async () =>
        {
            await ExecuteAsync(cmd.NoteId, note => note.Handle(cmd), ct, mustExist: cmd.MustExist).ConfigureAwait(false);
            return cmd.NoteId;
        });

    private async Task ExecuteAsync(NoteId noteId, Func<Note, IReadOnlyList<IDomainEvent>> handle, CancellationToken ct,
        bool mustExist = true)
    {
        var streamId = noteId.ToStreamId();
        // Read → rebuild → handle → append is retried as a unit: each attempt re-reads
        // the stream so the pure aggregate runs against the latest version, and the
        // append targets that fresh expected version. Only ConcurrencyException is
        // retried; any other failure (or an exhausted budget) propagates unchanged.
        for (var attempt = 1; ; attempt++)
        {
            var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
            var note = Rebuild(history);
            // Covers both a never-created note (empty stream) and a deleted one whose
            // stream still exists: either way the aggregate is gone, so the write is a
            // 404 rather than a domain InvalidOperationException that escapes as a 500.
            if (mustExist && !note.Exists) throw new NoteNotFoundException(noteId);
            var newEvents = handle(note);
            if (newEvents.Count == 0) return;

            var envelopes = ToEnvelopes(streamId, newEvents, currentUser.UserId, currentWorkspace.WorkspaceId);
            try
            {
                await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
            }
            catch (ConcurrencyException) when (attempt < MaxAppendAttempts)
            {
                await DelayBeforeRetryAsync(attempt, ct).ConfigureAwait(false);
                continue;
            }
            await UpdateProjectionAsync(noteId, history, envelopes, ct).ConfigureAwait(false);
            return;
        }
    }

    private static Task DelayBeforeRetryAsync(int attempt, CancellationToken ct)
    {
        var backoff = AppendRetryBaseDelay.TotalMilliseconds * Math.Pow(2, attempt - 1);
        var jitter = Random.Shared.NextDouble() * backoff * 0.2;
        return Task.Delay(TimeSpan.FromMilliseconds(backoff + jitter), ct);
    }

    private async Task UpdateProjectionAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        if (newEnvelopes.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            // Classify tag feedback for the batch before dropping provenance, so an untag that
            // shares a batch with the delete is recorded as a rejection exactly as a rebuild would.
            await UpdateTagFeedbackForNewEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
            await DeleteAllProjections(noteId, ct).ConfigureAwait(false);
            var existingCard = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
            if (existingCard is null) return;
            await noteCardListStore.UpsertAsync(
                existingCard with { Deleted = true, LastModifiedAt = newEnvelopes[0].OccurredAt }, ct).ConfigureAwait(false);
            return;
        }

        var (item, noteDetail) = RebuildTitleAndDetailProjections(noteId, history, newEnvelopes);
        await noteTitleStore.UpsertAsync(item, ct).ConfigureAwait(false);
        await noteDetailStore.UpsertAsync(noteDetail, ct).ConfigureAwait(false);
        await UpdateSearchViewAsync(noteId, noteDetail, ct).ConfigureAwait(false);

        if (newEnvelopes.Any(e => e.EventType == nameof(NoteRenamed)))
            await todoListStore.UpdateNoteTitleAsync(noteId, item.Title, ct).ConfigureAwait(false);

        var card = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
        await noteCardListStore.UpsertAsync(
            ApplyNoteEventsToCard(card, noteId, newEnvelopes), ct).ConfigureAwait(false);

        // Tag rows inherit the note's CURRENT workspace (from the rebuilt detail), not the
        // request route's workspace — so the live write matches what a rebuild would produce
        // even if a note is tagged via a different workspace's route.
        await UpdateTagIndexForNewEventsAsync(noteDetail.WorkspaceId, newEnvelopes, ct).ConfigureAwait(false);
        await UpdateTagFeedbackForNewEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
        await UpdateActionItemFeedbackForNewEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
        await UpdateCalendarLinkIndexForNewEventsAsync(noteId, newEnvelopes, ct).ConfigureAwait(false);
    }

    private async Task UpdateSearchViewAsync(NoteId noteId, NoteDetailView detail, CancellationToken ct)
    {
        var existing = await noteSearchViewStore.GetByNoteIdAsync(noteId, ct).ConfigureAwait(false);
        var actionItemsText = existing?.ActionItemsText ?? string.Empty;
        var finalNotes = ComposeFinalNotes(detail);
        var view = new NoteSearchView(noteId, detail.UserId, detail.Title, detail.Content, finalNotes,
            detail.Tags ?? [], actionItemsText, false, detail.LastModifiedAt, detail.WorkspaceId);
        await noteSearchViewStore.UpsertAsync(view, ct).ConfigureAwait(false);
    }

    private static string ComposeFinalNotes(NoteDetailView detail) =>
        string.Join(" ", new[] { detail.Summary ?? string.Empty }
            .Concat(detail.DiscussionPoints ?? [])
            .Concat(detail.Decisions ?? [])
            .Where(s => !string.IsNullOrWhiteSpace(s)));

    private async Task UpdateActionItemFeedbackForNewEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case ActionItemsSuggestedV2 e:
                    await RecordActionSuggestionsAsync(e.ActionItemIds, e.PromptVersion, ct).ConfigureAwait(false);
                    break;
                case ActionItemsSuggested e:
                    await RecordActionSuggestionsAsync(e.ActionItemIds, ActionItemFeedbackProjection.UnknownPromptVersion, ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
        }
    }

    private async Task RecordActionSuggestionsAsync(IReadOnlyList<Guid> actionItemIds, string promptVersion, CancellationToken ct)
    {
        foreach (var actionItemId in actionItemIds)
            await actionItemFeedbackStore.RecordSuggestionAsync(currentUser.UserId, actionItemId.ToString(), promptVersion, ct).ConfigureAwait(false);
    }

    private async Task UpdateTagFeedbackForNewEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case TagsSuggestedV2 e:
                    await RecordTagSuggestionsAsync(e.NoteId, e.Tags, e.PromptVersion, ct).ConfigureAwait(false);
                    break;
                case TagsSuggested e:
                    await RecordTagSuggestionsAsync(e.NoteId, e.Tags, TagFeedbackProjection.UnknownPromptVersion, ct).ConfigureAwait(false);
                    break;
                case NoteUntagged e:
                    await tagFeedbackStore.TryRecordRejectionAsync(e.NoteId.Value.ToString("N"), e.Tag, ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
        }
    }

    private async Task RecordTagSuggestionsAsync(NoteId noteId, IReadOnlyList<string> tags, string promptVersion, CancellationToken ct)
    {
        foreach (var tag in tags)
            await tagFeedbackStore.RecordSuggestionAsync(currentUser.UserId, noteId.Value.ToString("N"), tag, promptVersion, ct).ConfigureAwait(false);
    }

    private static (NoteTitleListItem TitleItem, NoteDetailView Detail) RebuildTitleAndDetailProjections(
        NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes)
    {
        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        foreach (var e in history) { titleList.Handle(e); detail.Handle(e); }
        foreach (var e in newEnvelopes) { titleList.Handle(e); detail.Handle(e); }

        var item = titleList.GetView().Items.FirstOrDefault(i => i.NoteId == noteId)
            ?? throw new NoteNotFoundException(noteId);
        var noteDetail = detail.GetDetail(noteId)
            ?? throw new NoteNotFoundException(noteId);
        return (item, noteDetail);
    }

    private async Task UpdateTagIndexForNewEventsAsync(string? noteWorkspaceId, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case NoteTagged e:
                    await tagIndexStore.PutAsync(e.Tag, e.NoteId.Value.ToString("N"), currentUser.UserId, noteWorkspaceId, ct).ConfigureAwait(false);
                    break;
                case NoteUntagged e:
                    await tagIndexStore.DeleteAsync(e.Tag, e.NoteId.Value.ToString("N"), ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
        }
    }

    private async Task UpdateCalendarLinkIndexForNewEventsAsync(NoteId noteId, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            if (EventDeserializer.Deserialize(envelope) is NoteLinkedToCalendarEvent e)
                await calendarLinkIndexStore.UpsertAsync(
                    new CalendarLinkView(e.CalendarEventId, noteId.Value.ToString(), e.RecurringSeriesId, e.StartTime, e.EndTime, e.CalendarEventTitle, currentUser.UserId), ct)
                    .ConfigureAwait(false);
        }
    }

    private async Task DeleteAllProjections(NoteId noteId, CancellationToken ct)
    {
        await noteTitleStore.DeleteAsync(noteId, ct).ConfigureAwait(false);
        await noteDetailStore.DeleteAsync(noteId, ct).ConfigureAwait(false);
        await todoListStore.DeleteByNoteAsync(noteId, ct).ConfigureAwait(false);
        await tagIndexStore.DeleteByNoteAsync(noteId.Value.ToString("N"), ct).ConfigureAwait(false);
        await tagFeedbackStore.DeleteProvenanceByNoteAsync(noteId.Value.ToString("N"), ct).ConfigureAwait(false);
        await calendarLinkIndexStore.DeleteByNoteIdAsync(noteId.Value.ToString(), ct).ConfigureAwait(false);
        await noteSearchViewStore.DeleteAsync(noteId, ct).ConfigureAwait(false);
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
                        envelope.OccurredAt, envelope.OccurredAt, false,
                        UserId: envelope.Metadata.UserId ?? "");
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
                case NoteFiledInFolder e when card is not null:
                    card = card with { FolderId = e.FolderId, LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteUnfiled when card is not null:
                    card = card with { FolderId = null, LastModifiedAt = envelope.OccurredAt };
                    break;
                case NoteAssignedToWorkspace e when card is not null:
                    card = card with { WorkspaceId = e.WorkspaceId.Value };
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

    private static List<EventEnvelope> ToEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events, string userId, string? workspaceId) =>
        events.Select(e =>
        {
            // Versioned events are persisted under their logical (v1) EventType name with a bumped
            // EventVersion, so a stream's history reads as one type across versions. The aggregate emits
            // ContentEdited but it is stored as ContentEditedV2; the V2 suggestion events (10-M) carry
            // their own shape but persist under the TagsSuggested/ActionItemsSuggested names at version 2.
            var (type, version, payload) = e switch
            {
                ContentEdited ce => (nameof(ContentEdited), 2, JsonSerializer.Serialize(
                    new ContentEditedV2(ce.NoteId, ce.NewContent, ce.NewContent.Length))),
                TagsSuggestedV2 => (nameof(TagsSuggested), 2, JsonSerializer.Serialize(e, e.GetType())),
                ActionItemsSuggestedV2 => (nameof(ActionItemsSuggested), 2, JsonSerializer.Serialize(e, e.GetType())),
                _ => (e.GetType().Name, InitialEventVersion, JsonSerializer.Serialize(e, e.GetType()))
            };

            return new EventEnvelope(
                StreamId: streamId, SequenceNumber: 0, EventType: type, EventVersion: version,
                OccurredAt: DateTimeOffset.UtcNow, Payload: payload,
                Metadata: new EventMetadata(Guid.NewGuid(), userId, null, null, workspaceId));
        }).ToList();
}
