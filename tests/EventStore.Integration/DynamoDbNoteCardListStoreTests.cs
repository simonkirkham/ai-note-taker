using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;
using EventStore.Projections;

namespace EventStore.Integration;

// RYW-2: the note card is a cross-aggregate row — note events own the note fields, action events
// own the ActionItems. Once notes are async (projector) while actions stay inline, both writers
// touch the same row concurrently. The field-level UpdateItem writes must commute (each SETs only
// its own attributes). The in-memory Api.Integration double models this; only DynamoDB Local
// proves the real UpdateExpression (SET/REMOVE/if_not_exists) is well-formed.
public sealed class DynamoDbNoteCardListStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task UpsertNoteFields_CreatesRow_AndSeedsEmptyActionItems()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());

        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Planning"));

        var card = await store.GetByNoteAsync(noteId);
        Assert.NotNull(card);
        Assert.Equal("Planning", card!.Title);
        // if_not_exists seeds ActionItems so the row is always readable.
        Assert.Empty(card.ActionItems);
    }

    [Fact]
    public async Task NoteFieldWrite_DoesNotClobberActionItems()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Planning"));

        var action = new NoteCardActionItem(new ActionId(Guid.NewGuid()), "Do the thing", false);
        await store.UpdateActionItemsAsync(noteId, [action], DateTimeOffset.UtcNow);

        // A later note-field write (rename) must leave the action items intact.
        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Renamed"));

        var card = await store.GetByNoteAsync(noteId);
        Assert.Equal("Renamed", card!.Title);
        Assert.Equal("Do the thing", Assert.Single(card.ActionItems).Description);
    }

    [Fact]
    public async Task ActionItemWrite_DoesNotClobberNoteFields()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Planning") with
        {
            Date = new DateOnly(2026, 7, 1),
            Tags = ["q3"],
            FolderId = new FolderId(Guid.NewGuid())
        });

        await store.UpdateActionItemsAsync(noteId,
            [new NoteCardActionItem(new ActionId(Guid.NewGuid()), "Task", true)], DateTimeOffset.UtcNow);

        var card = await store.GetByNoteAsync(noteId);
        // Note-owned fields survived the action write.
        Assert.Equal("Planning", card!.Title);
        Assert.Equal(new DateOnly(2026, 7, 1), card.Date);
        Assert.Equal(["q3"], card.Tags);
        Assert.NotNull(card.FolderId);
    }

    [Fact]
    public async Task UpsertNoteFields_RemovesOptionalAttributesWhenAbsent()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Tagged") with { Date = new DateOnly(2026, 7, 1), Tags = ["q3"] });

        // A subsequent write with no date/tags (e.g. untag-to-empty) must drop the attributes —
        // Dynamo cannot store an empty string set, so this would throw if written as a PutItem.
        await store.UpsertNoteFieldsAsync(NoteCard(noteId, "Tagged"));

        var card = await store.GetByNoteAsync(noteId);
        Assert.Null(card!.Date);
        Assert.Empty(card.Tags ?? []);
    }

    private async Task<DynamoDbNoteCardListStore> NewStoreAsync()
    {
        var tableName = $"test-cards-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbNoteCardListStore(_dynamo, tableName);
    }

    private static NoteCardView NoteCard(NoteId noteId, string title) =>
        new(noteId, title, "content", Array.Empty<NoteCardActionItem>(), null,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, false, UserId: "user-1");
}
