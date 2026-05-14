using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public interface INoteTitleListStore
{
    Task UpsertAsync(NoteTitleListItem item, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, CancellationToken ct = default);
    Task DeleteAllAsync(CancellationToken ct = default);
    Task<NoteTitleListView> QueryAllAsync(CancellationToken ct = default);
}
