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
    ITagFeedbackStore tagFeedbackStore) : IProjectionRebuildHandler
{
    public async Task<int> RebuildAsync(CancellationToken ct = default)
    {
        await titleStore.DeleteAllAsync(ct).ConfigureAwait(false);
        await detailStore.DeleteAllAsync(ct).ConfigureAwait(false);
        await folderTreeStore.DeleteAllAsync(ct).ConfigureAwait(false);
        await tagIndexStore.DeleteAllAsync(ct).ConfigureAwait(false);
        await tagFeedbackStore.DeleteAllAsync(ct).ConfigureAwait(false);

        var allEvents = await store.ReadAllStreamsAsync(ct).ConfigureAwait(false);

        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        var noteCards = new NoteCardListProjection();
        var folderProjection = new FolderTreeProjection();
        var tagIndex = new TagIndexProjection();
        var tagFeedback = new TagFeedbackProjection();
        foreach (var e in allEvents)
        {
            titleList.Handle(e);
            detail.Handle(e);
            noteCards.Handle(e);
            folderProjection.Handle(e);
            tagIndex.Handle(e);
            tagFeedback.Handle(e);
        }

        var upsertTasks = titleList.GetView().Items
            .Select(item => titleStore.UpsertAsync(item, ct))
            .Concat(detail.GetAllDetails().Select(d => detailStore.UpsertAsync(d, ct)))
            .Concat(noteCards.GetAll().Select(c => noteCardListStore.UpsertAsync(c, ct)))
            .Concat(folderProjection.GetAll().Select(f => folderTreeStore.UpsertAsync(f, ct)))
            .Concat(tagIndex.GetAll().Select(v => tagIndexStore.PutAsync(v.Tag, v.NoteId, v.UserId, ct)))
            .Concat(tagFeedback.GetAggregates().Select(v => tagFeedbackStore.UpsertAggregateAsync(v, ct)))
            .Concat(tagFeedback.GetProvenance().Select(p => tagFeedbackStore.PutProvenanceAsync(p.NoteId, p.Tag, p.UserId, ct)));

        await Task.WhenAll(upsertTasks).ConfigureAwait(false);

        return titleList.GetView().Items.Count;
    }
}
