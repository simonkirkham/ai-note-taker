using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteTitleListItem(NoteId NoteId, string Title, DateTimeOffset LastModifiedAt);
