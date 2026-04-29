using Domain.Notes;

namespace EventStore.Projections;

public record NoteTitleListItem(NoteId NoteId, string Title, DateTimeOffset LastModifiedAt);

public record NoteTitleListView(IReadOnlyList<NoteTitleListItem> Items);

public sealed class NoteTitleListProjection
{
    public void Handle(EventEnvelope envelope) => throw new NotImplementedException();
    public NoteTitleListView GetView() => throw new NotImplementedException();
}
