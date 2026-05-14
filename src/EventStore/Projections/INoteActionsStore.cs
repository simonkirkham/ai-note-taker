using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public interface INoteActionsStore
{
    Task UpsertAsync(NoteId noteId, NoteAction item, CancellationToken ct = default);
    Task DeleteAsync(NoteId noteId, ActionId actionId, CancellationToken ct = default);
    Task<NoteActionsView> QueryByNoteAsync(NoteId noteId, CancellationToken ct = default);
}
