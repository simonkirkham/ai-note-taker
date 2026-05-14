using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteDetailView(
    NoteId NoteId,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    DateOnly? Date = null,
    IReadOnlyList<string>? Tags = null);
