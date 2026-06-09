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
        foreach (var clear in new Func<CancellationToken, Task>[]
                 {
                     titleStore.DeleteAllAsync,
                     detailStore.DeleteAllAsync,
                     folderTreeStore.DeleteAllAsync,
                     tagIndexStore.DeleteAllAsync,
                     tagFeedbackStore.DeleteAllAsync,
                     actionItemFeedbackStore.DeleteAllAsync,
                     calendarLinkIndexStore.DeleteAllAsync,
                     noteSearchViewStore.DeleteAllAsync,
                 })
        {
            await BoundedWrites.WithRetryAsync(clear, ct: ct).ConfigureAwait(false);
        }

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

        var writes = new List<Func<CancellationToken, Task>>();
        void Add<T>(IEnumerable<T> items, Func<T, CancellationToken, Task> op)
        {
            foreach (var item in items)
                writes.Add(c => op(item, c));
        }

        Add(titleList.GetView().Items, (i, c) => titleStore.UpsertAsync(i, c));
        Add(detail.GetAllDetails(), (d, c) => detailStore.UpsertAsync(d, c));
        Add(noteCards.GetAll(), (card, c) => noteCardListStore.UpsertAsync(card, c));
        Add(folderProjection.GetAll(), (f, c) => folderTreeStore.UpsertAsync(f, c));
        Add(tagIndex.GetAll(), (v, c) => tagIndexStore.PutAsync(v.Tag, v.NoteId, v.UserId, c));
        Add(tagFeedback.GetAggregates(), (v, c) => tagFeedbackStore.UpsertAggregateAsync(v, c));
        Add(tagFeedback.GetProvenance(), (p, c) => tagFeedbackStore.PutProvenanceAsync(p.NoteId, p.Tag, p.UserId, p.PromptVersion, c));
        Add(actionFeedback.GetAggregates(), (v, c) => actionItemFeedbackStore.UpsertAggregateAsync(v, c));
        Add(actionFeedback.GetProvenance(), (p, c) => actionItemFeedbackStore.PutProvenanceAsync(p.ActionItemId, p.UserId, p.PromptVersion, c));
        Add(calendarLinks.GetAll(), (v, c) => calendarLinkIndexStore.UpsertAsync(v, c));
        Add(searchView.GetAll(), (v, c) => noteSearchViewStore.UpsertAsync(v, c));

        await BoundedWrites.RunAsync(writes, ct: ct).ConfigureAwait(false);

        return titleList.GetView().Items.Count;
    }
}
