using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record TodoItem(
    ActionId ActionId,
    NoteId NoteId,
    string NoteTitle,
    string Description,
    DateTimeOffset AddedAt);
