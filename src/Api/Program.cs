using Amazon.DynamoDBv2;
using Api;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Mvc;

var tableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");
var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

var builder = WebApplication.CreateBuilder(args);
if (builder.Environment.IsDevelopment())
    builder.Services.AddCors();
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddSingleton<IEventStore>(sp =>
    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), tableName));
builder.Services.AddSingleton(sp =>
    new NoteTitleListStore(sp.GetRequiredService<IAmazonDynamoDB>(), projTableName));
builder.Services.AddSingleton<NoteCommandHandler>();
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

var app = builder.Build();
app.Services.GetRequiredService<IEventStore>();
app.Services.GetRequiredService<NoteCommandHandler>();

if (app.Environment.IsDevelopment())
    app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/secret", () => Results.Ok(new { status = "shhhh...." }));

app.MapPost("/notes", async ([FromBody] CreateNoteRequest? req, NoteCommandHandler handler) =>
{
    var noteId = req?.NoteId is { } id && id != Guid.Empty ? new NoteId(id) : new NoteId(Guid.NewGuid());
    try { await handler.HandleAsync(new CreateNote(noteId)); }
    catch (InvalidOperationException) { return Results.Conflict(); }
    return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
});

app.MapPatch("/notes/{noteId}/title", async (Guid noteId, [FromBody] RenameNoteRequest req, NoteCommandHandler handler) =>
{
    try { await handler.HandleAsync(new RenameNote(new NoteId(noteId), req.Title)); }
    catch (NoteNotFoundException) { return Results.NotFound(); }
    return Results.Ok();
});

app.MapGet("/notes", async (NoteTitleListStore projStore) =>
{
    var view = await projStore.QueryAllAsync();
    return Results.Ok(new { items = view.Items.Select(i => new { noteId = i.NoteId.Value, title = i.Title }) });
});

app.Run();

record CreateNoteRequest(Guid? NoteId);
record RenameNoteRequest(string Title);
