using System.Text.Json;
using Amazon.DynamoDBv2;
using Domain;
using Domain.Notes;
using EventStore;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddSingleton<IEventStore>(sp =>
{
    var dynamo = sp.GetRequiredService<IAmazonDynamoDB>();
    var tableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
        ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");
    return new DynamoDbEventStore(dynamo, tableName);
});
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/secret", () => Results.Ok(new { status = "shhhh...." }));

app.MapPost("/notes", async ([FromBody] CreateNoteRequest? req, IEventStore store) =>
{
    var noteId = req?.NoteId is { } id && id != Guid.Empty
        ? new NoteId(id)
        : new NoteId(Guid.NewGuid());

    var streamId = $"note#{noteId}";
    var priorEvents = await store.ReadAsync(streamId);

    var aggregate = new Note();
    foreach (var e in priorEvents)
        aggregate.Apply(Deserialize(e));

    IReadOnlyList<IDomainEvent> newEvents;
    try
    {
        newEvents = aggregate.Handle(new CreateNote(noteId));
    }
    catch (InvalidOperationException)
    {
        return Results.Conflict();
    }

    var envelopes = newEvents.Select((e, i) => new EventEnvelope(
        StreamId: streamId,
        SequenceNumber: 0,
        EventType: e.GetType().Name,
        EventVersion: 1,
        OccurredAt: DateTimeOffset.UtcNow,
        Payload: JsonSerializer.Serialize(e, e.GetType()),
        Metadata: new EventMetadata(Guid.NewGuid(), null, null, null)
    )).ToList();

    await store.AppendAsync(streamId, priorEvents.Count, envelopes);

    return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
});

app.Run();

static IDomainEvent Deserialize(EventEnvelope envelope) => envelope.EventType switch
{
    nameof(NoteCreated) => JsonSerializer.Deserialize<NoteCreated>(envelope.Payload)!,
    nameof(NoteRenamed) => JsonSerializer.Deserialize<NoteRenamed>(envelope.Payload)!,
    _ => throw new InvalidOperationException($"Unknown event type: {envelope.EventType}")
};

record CreateNoteRequest(Guid? NoteId);
