using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api;

public sealed class ProjectionRebuildHandler(
    IEventStore store,
    INoteTitleListStore titleStore,
    INoteDetailStore detailStore)
{
    public async Task<int> RebuildAsync(CancellationToken ct = default)
    {
        await titleStore.DeleteAllAsync(ct).ConfigureAwait(false);
        await detailStore.DeleteAllAsync(ct).ConfigureAwait(false);

        var allEvents = await store.ReadAllStreamsAsync(ct).ConfigureAwait(false);

        var titleList = new NoteTitleListProjection();
        var detail = new NoteDetailProjection();
        foreach (var e in allEvents)
        {
            titleList.Handle(e);
            detail.Handle(e);
        }

        var upsertTasks = titleList.GetView().Items
            .Select(item => titleStore.UpsertAsync(item, ct))
            .Concat(detail.GetAllDetails().Select(d => detailStore.UpsertAsync(d, ct)));

        await Task.WhenAll(upsertTasks).ConfigureAwait(false);

        return titleList.GetView().Items.Count;
    }
}
