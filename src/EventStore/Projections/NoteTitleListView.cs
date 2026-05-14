using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteTitleListView(IReadOnlyList<NoteTitleListItem> Items);
