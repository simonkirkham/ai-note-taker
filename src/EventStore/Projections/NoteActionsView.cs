using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Notes;

namespace EventStore.Projections;

public record NoteActionsView(
    NoteId NoteId,
    IReadOnlyList<NoteAction> Actions);
