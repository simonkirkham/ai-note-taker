using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;
using EventStore.Projections;

namespace EventStore.Integration;

// 33-B2: NoteDetail.OwnerName must survive the real DynamoDB round-trip — the in-memory
// Api.Integration store keeps the whole view by reference and so cannot catch a missing
// UpsertAsync/MapItemToNoteDetailView mapping. The headless re-analysis reads OwnerName from this
// store in prod, so the persisted-then-read value is load-bearing.
public sealed class DynamoDbNoteDetailStoreTests(DynamoDbFixture fixture) : IClassFixture<DynamoDbFixture>
{
    private readonly IAmazonDynamoDB _dynamo = fixture.DynamoDb;

    [Fact]
    public async Task OwnerName_RoundTripsThroughDynamo()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1", OwnerName: "Alice Smith"));

        var read = await store.GetAsync(noteId);

        Assert.Equal("Alice Smith", read!.OwnerName);
    }

    [Fact]
    public async Task OwnerName_DefaultsToEmpty_WhenAbsent()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1")); // no OwnerName (e.g. pre-33-B2 note)

        var read = await store.GetAsync(noteId);

        Assert.Equal("", read!.OwnerName);
    }

    // 43-A: the composed Agenda list must survive the real DynamoDB round-trip — the in-memory
    // Api.Integration store keeps the whole view by reference and so cannot catch a missing
    // UpsertAsync/MapItemToNoteDetailView mapping (the guardrail that bit OwnerName in 33-B2).
    [Fact]
    public async Task Agenda_RoundTripsThroughDynamo()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        var item1 = Guid.NewGuid();
        var item2 = Guid.NewGuid();
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1",
            Agenda:
            [
                new AgendaItemView(item1, "Budget (Q3)", false, 0),
                new AgendaItemView(item2, "Hiring backfill", true, 1)
            ]));

        var read = await store.GetAsync(noteId);

        Assert.NotNull(read!.Agenda);
        Assert.Equal(2, read.Agenda!.Count);
        Assert.Equal(item1, read.Agenda[0].ItemId);
        Assert.Equal("Budget (Q3)", read.Agenda[0].Text);
        Assert.False(read.Agenda[0].Discussed);
        Assert.Equal(0, read.Agenda[0].Position);
        Assert.Equal("Hiring backfill", read.Agenda[1].Text);
        Assert.True(read.Agenda[1].Discussed);
        Assert.Equal(1, read.Agenda[1].Position);
    }

    // 43-F: topics are now DERIVED from the note body rather than carried by AgendaItem* events, so
    // the round-trip has to hold for a view the projection composed — including the deterministic
    // ids, which have no event to fall back on if the mapping drops them.
    [Fact]
    public async Task AgendaDerivedFromBody_RoundTripsThroughDynamo()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        const string content = "- [x] Budget (Q3)\n- [ ] Hiring plan\n\nRob says cloud spend is 8% over.";
        var composed = AgendaFromContent.Parse(noteId, content);

        await store.UpsertAsync(new NoteDetailView(noteId, "Ops weekly", content,
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1", Agenda: composed));

        var read = await store.GetAsync(noteId);

        Assert.NotNull(read!.Agenda);
        Assert.Equal(2, read.Agenda!.Count);
        Assert.Equal("Budget (Q3)", read.Agenda[0].Text);
        Assert.True(read.Agenda[0].Discussed);
        Assert.Equal("Hiring plan", read.Agenda[1].Text);
        Assert.False(read.Agenda[1].Discussed);
        // The derived id is a function of the note + text, so it must survive unchanged.
        Assert.Equal(composed[0].ItemId, read.Agenda[0].ItemId);
        Assert.Equal(composed[1].ItemId, read.Agenda[1].ItemId);
    }

    [Fact]
    public async Task Agenda_DefaultsToNull_WhenAbsent()
    {
        var store = await NewStoreAsync();
        var noteId = new NoteId(Guid.NewGuid());
        await store.UpsertAsync(new NoteDetailView(noteId, "Title", "content",
            DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, UserId: "user-1")); // no Agenda (pre-43-A note)

        var read = await store.GetAsync(noteId);

        Assert.Null(read!.Agenda);
    }

    private async Task<DynamoDbNoteDetailStore> NewStoreAsync()
    {
        var tableName = $"test-notedetail-{Guid.NewGuid():N}";
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = tableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        return new DynamoDbNoteDetailStore(_dynamo, tableName);
    }
}
