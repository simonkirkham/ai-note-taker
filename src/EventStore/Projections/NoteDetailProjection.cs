using Domain.Notes;

namespace EventStore.Projections;

public record NoteDetailView(
    NoteId NoteId,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt);

public interface INoteDetailStore
{
    Task UpsertAsync(NoteDetailView detail, CancellationToken ct = default);
    Task<NoteDetailView?> GetAsync(NoteId noteId, CancellationToken ct = default);
}

public sealed class NoteDetailProjection
{
    private readonly Dictionary<NoteId, NoteDetailView> _items = new();

    public void Handle(EventEnvelope envelope) => throw new NotImplementedException();

    public NoteDetailView? GetDetail(NoteId noteId) => throw new NotImplementedException();
}
