using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteAction(
    ActionId ActionId,
    string Description,
    bool Completed,
    DateTimeOffset AddedAt,
    DateTimeOffset? CompletedAt);
