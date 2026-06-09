using EventStore;
using EventStore.Projections;

namespace Api.CommandHandlers;

public sealed class ProjectionRebuildHandler(
    IEventStore store,
    INoteTitleListStore titleStore,
    INoteDetailStore detailStore,
    INoteCardListStore noteCardListStore,
    IFolderTreeStore folderTreeStore,
    ITagIndexStore tagIndexStore,
    ITagFeedbackStore tagFeedbackStore,
    IActionItemFeedbackStore actionItemFeedbackStore,
    ICalendarLinkIndexStore calendarLinkIndexStore,
    INoteSearchViewStore noteSearchViewStore) : IProjectionRebuildHandler
{
    public async Task<int> RebuildAsync(CancellationToken ct = default)
    {
        // The feedback projections are monotonic provenance — the live path never deletes their
        // aggregate rows — so they stay delete-then-rebuild. Every user-facing projection below
        // switches to upsert-then-reconcile: the table is never wiped first, so a fault leaves
        // stale-but-present rows, never missing ones.
        await BoundedWrites.WithRetryAsync(tagFeedbackStore.DeleteAllAsync, ct: ct).ConfigureAwait(false);
        await BoundedWrites.WithRetryAsync(actionItemFeedbackStore.DeleteAllAsync, ct: ct).ConfigureAwait(false);

        var allEvents = await store.ReadAllStreamsAsync(ct).ConfigureAwait(false);

        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        var noteCards = new NoteCardListProjection();
        var folderProjection = new FolderTreeProjection();
        var tagIndex = new TagIndexProjection();
        var tagFeedback = new TagFeedbackProjection();
        var actionFeedback = new ActionItemFeedbackProjection();
        var calendarLinks = new CalendarLinkIndexProjection();
        var searchView = new NoteSearchViewProjection();
        foreach (var e in allEvents)
        {
            titleList.Handle(e);
            detail.Handle(e);
            noteCards.Handle(e);
            folderProjection.Handle(e);
            tagIndex.Handle(e);
            tagFeedback.Handle(e);
            actionFeedback.Handle(e);
            calendarLinks.Handle(e);
            searchView.Handle(e);
        }

        var titles = titleList.GetView().Items;
        var details = detail.GetAllDetails().ToList();
        var cards = noteCards.GetAll();
        var folders = folderProjection.GetAll();
        var tags = tagIndex.GetAll();
        var links = calendarLinks.GetAll();
        // A deleted note is pruned from search to match the live hard-delete (no Deleted=true tombstone);
        // the reconcile pass below removes any tombstone already in the table.
        var searches = searchView.GetAll().Where(v => !v.Deleted).ToList();

        var writes = new List<Func<CancellationToken, Task>>();
        void Add<T>(IEnumerable<T> items, Func<T, CancellationToken, Task> op)
        {
            foreach (var item in items)
                writes.Add(c => op(item, c));
        }

        Add(titles, (i, c) => titleStore.UpsertAsync(i, c));
        Add(details, (d, c) => detailStore.UpsertAsync(d, c));
        Add(cards, (x, c) => noteCardListStore.UpsertAsync(x, c));
        Add(folders, (f, c) => folderTreeStore.UpsertAsync(f, c));
        Add(tags, (v, c) => tagIndexStore.PutAsync(v.Tag, v.NoteId, v.UserId, c));
        Add(links, (v, c) => calendarLinkIndexStore.UpsertAsync(v, c));
        Add(searches, (v, c) => noteSearchViewStore.UpsertAsync(v, c));
        Add(tagFeedback.GetAggregates(), (v, c) => tagFeedbackStore.UpsertAggregateAsync(v, c));
        Add(tagFeedback.GetProvenance(), (p, c) => tagFeedbackStore.PutProvenanceAsync(p.NoteId, p.Tag, p.UserId, p.PromptVersion, c));
        Add(actionFeedback.GetAggregates(), (v, c) => actionItemFeedbackStore.UpsertAggregateAsync(v, c));
        Add(actionFeedback.GetProvenance(), (p, c) => actionItemFeedbackStore.PutProvenanceAsync(p.ActionItemId, p.UserId, p.PromptVersion, c));

        await BoundedWrites.RunAsync(writes, ct: ct).ConfigureAwait(false);

        var deletes = new List<Func<CancellationToken, Task>>();
        void AddStale<TKey>(IEnumerable<TKey> existing, IReadOnlySet<TKey> keep, Func<TKey, CancellationToken, Task> del)
        {
            foreach (var key in existing)
                if (!keep.Contains(key))
                    deletes.Add(c => del(key, c));
        }

        AddStale((await titleStore.QueryAllAsync(ct).ConfigureAwait(false)).Items.Select(x => x.NoteId),
            titles.Select(x => x.NoteId).ToHashSet(), (k, c) => titleStore.DeleteAsync(k, c));
        AddStale((await detailStore.QueryAllAsync(ct).ConfigureAwait(false)).Select(x => x.NoteId),
            details.Select(x => x.NoteId).ToHashSet(), (k, c) => detailStore.DeleteAsync(k, c));
        AddStale((await noteCardListStore.QueryAllAsync(ct).ConfigureAwait(false)).Select(x => x.NoteId),
            cards.Select(x => x.NoteId).ToHashSet(), (k, c) => noteCardListStore.DeleteAsync(k, c));
        AddStale((await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false)).Select(x => x.FolderId),
            folders.Select(x => x.FolderId).ToHashSet(), (k, c) => folderTreeStore.DeleteAsync(k, c));
        AddStale((await tagIndexStore.GetAllAsync(ct).ConfigureAwait(false)).Select(x => (x.Tag, x.NoteId)),
            tags.Select(x => (x.Tag, x.NoteId)).ToHashSet(), (k, c) => tagIndexStore.DeleteAsync(k.Tag, k.NoteId, c));
        AddStale((await calendarLinkIndexStore.GetAllAsync(ct).ConfigureAwait(false)).Select(x => x.CalendarEventId),
            links.Select(x => x.CalendarEventId).ToHashSet(), (k, c) => calendarLinkIndexStore.DeleteAsync(k, c));
        AddStale((await noteSearchViewStore.QueryAllAsync(ct).ConfigureAwait(false)).Select(x => x.NoteId),
            searches.Select(x => x.NoteId).ToHashSet(), (k, c) => noteSearchViewStore.DeleteAsync(k, c));

        await BoundedWrites.RunAsync(deletes, ct: ct).ConfigureAwait(false);

        return titles.Count;
    }
}
