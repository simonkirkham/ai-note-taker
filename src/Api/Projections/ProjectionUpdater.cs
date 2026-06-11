using Domain;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;
using Domain.Todos;
using Domain.Workspaces;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.Exceptions;
using Api.Services;

namespace Api.Projections;

// Holds all read-model write logic lifted out of the 5 command handlers (27-A). Each handler
// still calls the matching method inline, at the same point in its flow, so a single apply is
// byte-identical to the previous inline behaviour. This is a facade over the projection stores;
// its many dependencies are deliberate — they are the union of what the 5 handlers used to inject.
public sealed class ProjectionUpdater(
    INoteTitleListStore noteTitleStore,
    INoteDetailStore noteDetailStore,
    ITodoListStore todoListStore,
    INoteCardListStore noteCardListStore,
    INoteActionsStore noteActionsStore,
    ITagIndexStore tagIndexStore,
    ITagFeedbackStore tagFeedbackStore,
    IActionItemFeedbackStore actionItemFeedbackStore,
    ICalendarLinkIndexStore calendarLinkIndexStore,
    INoteSearchViewStore noteSearchViewStore,
    IFolderTreeStore folderTreeStore,
    IWorkspaceListStore workspaceListStore,
    ICurrentUser currentUser,
    INoteImageStore noteImageStore,
    ILogger<ProjectionUpdater> logger) : IProjectionUpdater
{
    public async Task ApplyNoteEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        if (newEnvelopes.Any(e => e.EventType == nameof(NoteDeleted)))
        {
            // Classify tag feedback for the batch before dropping provenance, so an untag that
            // shares a batch with the delete is recorded as a rejection exactly as a rebuild would.
            await UpdateTagFeedbackForNewEventsAsync(newEnvelopes, ct).ConfigureAwait(false);
            await DeleteAllProjections(noteId, ct).ConfigureAwait(false);
            // Purge the note's S3 image blobs — best-effort cleanup that must NEVER fail
            // the delete (the note is already gone; orphaned objects are a tolerable,
            // logged cost). Broad catch is deliberate: any S3 fault (incl. AmazonClient/
            // ServiceException for network/throttle) is swallowed; only cancellation propagates.
            try
            {
                await noteImageStore.PurgeNoteAsync(noteId.ToString(), ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogWarning(ex, "Failed to purge images for deleted note {NoteId}", noteId.ToString());
            }
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
        await RebucketWorkspaceForMoveAsync(noteId, noteDetail, newEnvelopes, ct).ConfigureAwait(false);
    }

    // A move re-emits NoteAssignedToWorkspace for an existing note. The card row is
    // re-stamped in ApplyNoteEventsToCard and title/detail/search rebuild from full
    // history, but the note's TodoList action rows and TagIndex rows are keyed
    // independently and must be re-stamped to the new workspace here so the live write
    // matches what a rebuild produces. At create there are no such rows (the batch
    // carries NoteCreated), so skip the extra store round-trips.
    private async Task RebucketWorkspaceForMoveAsync(NoteId noteId, NoteDetailView noteDetail, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        var isMove = newEnvelopes.Any(e => e.EventType == nameof(NoteAssignedToWorkspace))
            && !newEnvelopes.Any(e => e.EventType == nameof(NoteCreated));
        if (!isMove || noteDetail.WorkspaceId is null) return;

        // The todo re-stamp and each tag re-stamp are independent writes — run together.
        var noteKey = noteId.Value.ToString("N");
        var restamps = (noteDetail.Tags ?? [])
            .Select(tag => tagIndexStore.PutAsync(tag, noteKey, currentUser.UserId, noteDetail.WorkspaceId, ct))
            .Append(todoListStore.UpdateNoteWorkspaceAsync(noteId, noteDetail.WorkspaceId, ct));
        await Task.WhenAll(restamps).ConfigureAwait(false);
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
                // Append-if-absent so a redelivered NoteTagged does not duplicate the tag on the
                // card (27-A idempotency). For apply-once this is identical to a plain append.
                case NoteTagged e when card is not null:
                    card = (card.Tags ?? []).Contains(e.Tag)
                        ? card with { LastModifiedAt = envelope.OccurredAt }
                        : card with { Tags = (card.Tags ?? []).Append(e.Tag).ToList().AsReadOnly(), LastModifiedAt = envelope.OccurredAt };
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
                    // Only the card row is re-stamped here. Safe today because this event is
                    // emitted only at create (no action items yet). When a move command (23-F)
                    // re-emits it for an existing note, the live path must ALSO re-stamp the
                    // note's TodoList action rows (the rebuild TodoListProjection already
                    // back-fills them) — otherwise live and rebuild diverge for moved notes.
                    card = card with { WorkspaceId = e.WorkspaceId.Value };
                    break;
                default:
                    break;
            }
        }
        return card ?? throw new NoteNotFoundException(noteId);
    }

    public async Task ApplyActionItemEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        if (newEnvelopes.Any(e => e.EventType == nameof(ActionItemAdded)))
        {
            await ApplyActionItemAddedAsync(noteId, newEvents, newEnvelopes, ct).ConfigureAwait(false);
            return;
        }

        var addedEnvelope = history.First(e => e.EventType == nameof(ActionItemAdded));
        var addedEvent = (ActionItemAdded)EventDeserializer.Deserialize(addedEnvelope);

        foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
            switch (domainEvent)
            {
                case ActionItemCompleted e:
                    await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                        new NoteAction(e.ActionId, addedEvent.Description, true, addedEnvelope.OccurredAt, e.CompletedAt), ct).ConfigureAwait(false);
                    await todoListStore.UpdateCompletedAtAsync(e.ActionId.Value.ToString(), e.CompletedAt, ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Select(a => a.ActionId == e.ActionId ? a with { Completed = true } : a).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                    await actionItemFeedbackStore.TryRecordCompletionAsync(e.ActionId.Value.ToString(), ct).ConfigureAwait(false);
                    break;
                case ActionItemReopened e:
                    await noteActionsStore.UpsertAsync(addedEvent.NoteId,
                        new NoteAction(e.ActionId, addedEvent.Description, false, addedEnvelope.OccurredAt, null), ct).ConfigureAwait(false);
                    await todoListStore.UpdateCompletedAtAsync(e.ActionId.Value.ToString(), null, ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Select(a => a.ActionId == e.ActionId ? a with { Completed = false } : a).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                    break;
                case ActionItemDeleted e:
                    await noteActionsStore.DeleteAsync(addedEvent.NoteId, e.ActionId, ct).ConfigureAwait(false);
                    await todoListStore.DeleteAsync(e.ActionId.Value.ToString(), ct).ConfigureAwait(false);
                    await UpdateCardActionItemsAsync(addedEvent.NoteId,
                        items => items.Where(a => a.ActionId != e.ActionId).ToList().AsReadOnly(),
                        envelope.OccurredAt, ct).ConfigureAwait(false);
                    await actionItemFeedbackStore.TryRecordDeletionAsync(e.ActionId.Value.ToString(), ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
    }

    private async Task ApplyActionItemAddedAsync(NoteId noteId, IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        var noteDetail = await noteDetailStore.GetAsync(noteId, ct).ConfigureAwait(false);
        if (noteDetail is null) throw new NoteNotFoundException(noteId);

        foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
        {
            if (domainEvent is not ActionItemAdded e) continue;
            var action = new NoteAction(e.ActionId, e.Description, false, envelope.OccurredAt, null);
            await noteActionsStore.UpsertAsync(noteId, action, ct).ConfigureAwait(false);
            await todoListStore.PutAsync(
                new TodoItem(e.ActionId.Value.ToString(), e.NoteId.Value.ToString(), noteDetail.Title,
                    "action", e.Description, envelope.OccurredAt, null, currentUser.UserId, noteDetail.WorkspaceId), ct).ConfigureAwait(false);
            // Add-if-absent so a redelivered ActionItemAdded does not duplicate the card row
            // (27-A idempotency). For apply-once this is identical to a plain append.
            await UpdateCardActionItemsAsync(noteId,
                items => items.Any(a => a.ActionId == e.ActionId)
                    ? items
                    : items.Append(new NoteCardActionItem(e.ActionId, e.Description, false)).ToList().AsReadOnly(),
                envelope.OccurredAt, ct).ConfigureAwait(false);
        }
    }

    private async Task UpdateCardActionItemsAsync(NoteId noteId,
        Func<IReadOnlyList<NoteCardActionItem>, IReadOnlyList<NoteCardActionItem>> update,
        DateTimeOffset occurredAt,
        CancellationToken ct)
    {
        var card = await noteCardListStore.GetByNoteAsync(noteId, ct).ConfigureAwait(false);
        if (card is not { Deleted: false }) return;
        var updatedItems = update(card.ActionItems);
        await noteCardListStore.UpsertAsync(
            card with { ActionItems = updatedItems, LastModifiedAt = occurredAt }, ct).ConfigureAwait(false);
        await UpdateSearchViewActionsAsync(noteId, updatedItems, occurredAt, ct).ConfigureAwait(false);
    }

    private async Task UpdateSearchViewActionsAsync(NoteId noteId, IReadOnlyList<NoteCardActionItem> items,
        DateTimeOffset occurredAt, CancellationToken ct)
    {
        var existing = await noteSearchViewStore.GetByNoteIdAsync(noteId, ct).ConfigureAwait(false);
        if (existing is null) return;
        var actionItemsText = string.Join(" ", items.Select(i => i.Description));
        await noteSearchViewStore.UpsertAsync(
            existing with { ActionItemsText = actionItemsText, LastModifiedAt = occurredAt }, ct).ConfigureAwait(false);
    }

    public async Task ApplyTodoEventsAsync(IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var (domainEvent, envelope) in newEvents.Zip(newEnvelopes))
            switch (domainEvent)
            {
                case TodoAdded e:
                    await todoListStore.PutAsync(
                        new TodoItem(e.TodoId.Value.ToString(), null, null, "todo",
                            e.Description, envelope.OccurredAt, null, currentUser.UserId, envelope.Metadata.WorkspaceId), ct).ConfigureAwait(false);
                    break;
                case TodoCompleted e:
                    await todoListStore.UpdateCompletedAtAsync(e.TodoId.Value.ToString(), e.CompletedAt, ct).ConfigureAwait(false);
                    break;
                case TodoReopened e:
                    await todoListStore.UpdateCompletedAtAsync(e.TodoId.Value.ToString(), null, ct).ConfigureAwait(false);
                    break;
                case TodoDeleted e:
                    await todoListStore.DeleteAsync(e.TodoId.Value.ToString(), ct).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
    }

    public async Task ApplyFolderEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case FolderCreated e:
                    await folderTreeStore.UpsertAsync(
                        new FolderTreeView(e.FolderId, e.Name, e.ParentFolderId, envelope.OccurredAt, envelope.Metadata.UserId ?? "", envelope.Metadata.WorkspaceId), ct)
                        .ConfigureAwait(false);
                    break;
                case FolderRenamed e:
                    await ApplyFolderRenamedToProjectionAsync(e, ct).ConfigureAwait(false);
                    break;
                case FolderMoved e:
                    await ApplyFolderMovedToProjectionAsync(e, ct).ConfigureAwait(false);
                    break;
            }
        }
    }

    private async Task ApplyFolderRenamedToProjectionAsync(FolderRenamed e, CancellationToken ct)
    {
        var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        var existing = allFolders.FirstOrDefault(f => f.FolderId == e.FolderId);
        if (existing is null) return;
        await folderTreeStore.UpsertAsync(existing with { Name = e.NewName }, ct).ConfigureAwait(false);
    }

    private async Task ApplyFolderMovedToProjectionAsync(FolderMoved e, CancellationToken ct)
    {
        var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        var existing = allFolders.FirstOrDefault(f => f.FolderId == e.FolderId);
        if (existing is null) return;
        await folderTreeStore.UpsertAsync(existing with { ParentFolderId = e.NewParentFolderId }, ct).ConfigureAwait(false);
    }

    public async Task ApplyWorkspaceEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct)
    {
        foreach (var envelope in newEnvelopes)
        {
            switch (EventDeserializer.Deserialize(envelope))
            {
                case WorkspaceCreated e:
                    await workspaceListStore.UpsertAsync(
                        new WorkspaceListView(e.WorkspaceId, e.Name, envelope.OccurredAt, envelope.Metadata.UserId ?? ""), ct)
                        .ConfigureAwait(false);
                    break;
                case WorkspaceRenamed e:
                    await ApplyWorkspaceRenamedAsync(e, ct).ConfigureAwait(false);
                    break;
            }
        }
    }

    private async Task ApplyWorkspaceRenamedAsync(WorkspaceRenamed e, CancellationToken ct)
    {
        var all = await workspaceListStore.GetAllAsync(ct).ConfigureAwait(false);
        var existing = all.FirstOrDefault(w => w.WorkspaceId == e.WorkspaceId);
        if (existing is null) return;
        await workspaceListStore.UpsertAsync(existing with { Name = e.NewName }, ct).ConfigureAwait(false);
    }
}
