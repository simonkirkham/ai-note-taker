namespace EventStore.Projections;

public record NoteTitleListView(IReadOnlyList<NoteTitleListItem> Items);
