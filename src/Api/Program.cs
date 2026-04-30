using System.Text.Json;
using Amazon.DynamoDBv2;
using Domain;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Mvc;

var tableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");
var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddSingleton<IEventStore>(sp =>
    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), tableName));
builder.Services.AddSingleton(sp =>
    new NoteTitleListStore(sp.GetRequiredService<IAmazonDynamoDB>(), projTableName));
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

var app = builder.Build();
app.Services.GetRequiredService<IEventStore>();
app.Services.GetRequiredService<NoteTitleListStore>();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/secret", () => Results.Ok(new { status = "shhhh...." }));

app.MapPost("/notes", async ([FromBody] CreateNoteRequest? req, IEventStore store, NoteTitleListStore projStore) =>
{
    var noteId = req?.NoteId is { } id && id != Guid.Empty
        ? new NoteId(id)
        : new NoteId(Guid.NewGuid());

    var streamId = noteId.ToStreamId();
    var priorEvents = await store.ReadAsync(streamId);

    var aggregate = RebuildAggregate(priorEvents);

    IReadOnlyList<IDomainEvent> newEvents;
    try { newEvents = aggregate.Handle(new CreateNote(noteId)); }
    catch (InvalidOperationException) { return Results.Conflict(); }

    var envelopes = BuildEnvelopes(streamId, newEvents);

    await store.AppendAsync(streamId, priorEvents.Count, envelopes);

    var projection = new NoteTitleListProjection();
    foreach (var e in envelopes) projection.Handle(e);
    var item = projection.GetView().Items.First(i => i.NoteId == noteId);
    await projStore.UpsertAsync(item);

    return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
});

app.MapPatch("/notes/{noteId}/title", async (Guid noteId, [FromBody] RenameNoteRequest req, IEventStore store, NoteTitleListStore projStore) =>
{
    var id = new NoteId(noteId);
    var streamId = id.ToStreamId();
    var priorEvents = await store.ReadAsync(streamId);
    if (priorEvents.Count == 0) return Results.NotFound();

    var aggregate = RebuildAggregate(priorEvents);

    IReadOnlyList<IDomainEvent> newEvents = aggregate.Handle(new RenameNote(id, req.Title));

    if (newEvents.Count > 0)
    {
        var envelopes = BuildEnvelopes(streamId, newEvents);

        await store.AppendAsync(streamId, priorEvents.Count, envelopes);

        var projection = new NoteTitleListProjection();
        foreach (var e in priorEvents) projection.Handle(e);
        foreach (var e in envelopes) projection.Handle(e);
        var item = projection.GetView().Items.First(i => i.NoteId == id);
        await projStore.UpsertAsync(item);
    }

    return Results.Ok();
});

app.MapGet("/notes", async (NoteTitleListStore projStore) =>
{
    var view = await projStore.QueryAllAsync();
    return Results.Ok(new
    {
        items = view.Items.Select(i => new { noteId = i.NoteId.Value, title = i.Title })
    });
});

app.Run();

const int InitialEventVersion = 1;

static Note RebuildAggregate(IReadOnlyList<EventEnvelope> history)
{
    var note = new Note();
    foreach (var e in history)
        note.Apply(EventDeserializer.Deserialize(e));
    return note;
}

static List<EventEnvelope> BuildEnvelopes(string streamId, IReadOnlyList<IDomainEvent> events) =>
    events.Select(e => new EventEnvelope(
        StreamId: streamId, SequenceNumber: 0, EventType: e.GetType().Name, EventVersion: InitialEventVersion,
        OccurredAt: DateTimeOffset.UtcNow,
        Payload: JsonSerializer.Serialize(e, e.GetType()),
        Metadata: new EventMetadata(Guid.NewGuid(), null, null, null)
    )).ToList();

record CreateNoteRequest(Guid? NoteId);
record RenameNoteRequest(string Title);
