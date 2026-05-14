using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteCardActionItem(
    ActionId ActionId,
    string Description,
    bool Completed);
