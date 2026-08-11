using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Domain.Notes;
using EventStore.Projections;
using Testcontainers.DynamoDb;

namespace EventStore.Integration;

public sealed class DynamoDbTranscriptionDraftStoreTests : IAsyncLifetime
{
    private readonly DynamoDbContainer _container = new DynamoDbBuilder(DynamoDbLocalImage.Reference).Build();
    private const string TableName = "test-draft-transcription";
    private IAmazonDynamoDB _dynamo = null!;
    private DynamoDbTranscriptionDraftStore _store = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        var config = new AmazonDynamoDBConfig { ServiceURL = _container.GetConnectionString(), Timeout = TimeSpan.FromSeconds(5) };
        _dynamo = new AmazonDynamoDBClient("local", "local", config);
        await _dynamo.CreateTableAsync(new CreateTableRequest
        {
            TableName = TableName,
            AttributeDefinitions = [new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S }],
            KeySchema = [new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH }],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
        _store = new DynamoDbTranscriptionDraftStore(_dynamo, TableName);
    }

    public async Task DisposeAsync()
    {
        // Null when InitializeAsync threw before assigning it — see DynamoDbFixture.
        _dynamo?.Dispose();
        await _container.DisposeAsync();
    }

    [Fact]
    public async Task Save_then_Get_round_trips_the_draft()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var capturedAt = DateTimeOffset.UtcNow;
        await _store.SaveAsync(new TranscriptionDraft(noteId, "user-1", "Speaker 1: hello", 12, capturedAt));

        var got = await _store.GetAsync(noteId);

        Assert.NotNull(got);
        Assert.Equal("user-1", got!.UserId);
        Assert.Equal("Speaker 1: hello", got.Text);
        Assert.Equal(12, got.DurationSeconds);
        Assert.Equal(capturedAt.ToUnixTimeSeconds(), got.CapturedAt.ToUnixTimeSeconds());
    }

    [Fact]
    public async Task Save_overwrites_the_existing_draft_for_the_note()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await _store.SaveAsync(new TranscriptionDraft(noteId, "user-1", "first", 5, DateTimeOffset.UtcNow));
        await _store.SaveAsync(new TranscriptionDraft(noteId, "user-1", "first and second", 10, DateTimeOffset.UtcNow));

        var got = await _store.GetAsync(noteId);

        Assert.Equal("first and second", got!.Text);
    }

    [Fact]
    public async Task Save_writes_a_TTL_attribute_after_the_capture_time()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var capturedAt = DateTimeOffset.UtcNow;
        await _store.SaveAsync(new TranscriptionDraft(noteId, "user-1", "text", 1, capturedAt));

        var raw = await _dynamo.GetItemAsync(new GetItemRequest
        {
            TableName = TableName,
            Key = new Dictionary<string, AttributeValue> { ["PK"] = new() { S = noteId.ToStreamId() } }
        });

        Assert.True(raw.Item.TryGetValue("TTL", out var ttl), "draft item must carry a TTL attribute");
        Assert.True(long.Parse(ttl.N) > capturedAt.ToUnixTimeSeconds(), "TTL must be in the future relative to capture time");
    }

    [Fact]
    public async Task Get_returns_null_when_no_draft_exists()
    {
        var got = await _store.GetAsync(new NoteId(Guid.NewGuid()));
        Assert.Null(got);
    }

    [Fact]
    public async Task Delete_removes_the_draft_and_is_idempotent()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await _store.SaveAsync(new TranscriptionDraft(noteId, "user-1", "text", 1, DateTimeOffset.UtcNow));

        await _store.DeleteAsync(noteId);
        Assert.Null(await _store.GetAsync(noteId));

        // Deleting again must not throw.
        await _store.DeleteAsync(noteId);
    }
}
