using Amazon.DynamoDBv2;
using Api;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Mvc;

var eventTableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");

var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

WebApplicationBuilder builder = BuildServices(args, eventTableName, projTableName);

var app = builder.Build();

  app.UseExceptionHandler(exApp => exApp.Run(async ctx =>                                                                                       
  {
      var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;                                            
      var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api");                                                   
      log.LogError(ex, "Unhandled exception on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
      ctx.Response.StatusCode = 500;                                                                                                            
      await ctx.Response.WriteAsJsonAsync(new { error = "internal server error" });
  }));   
  
app.Services.GetRequiredService<IEventStore>();
app.Services.GetRequiredService<NoteCommandHandler>();

if (app.Environment.IsDevelopment())
    app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());

AddEndpointMapping(app);

app.Run();

static WebApplicationBuilder BuildServices(string[] args, string eventTableName, string projTableName)
{
    var builder = WebApplication.CreateBuilder(args);
    if (builder.Environment.IsDevelopment())
        builder.Services.AddCors();

    // Configure AmazonDynamoDB client with reduced timeouts (seconds).
    // Set DYNAMO_TIMEOUT_SECONDS env var to override the default (5s).
    var dynamoTimeoutSeconds = 5;
    if (int.TryParse(Environment.GetEnvironmentVariable("DYNAMO_TIMEOUT_SECONDS"), out var t) && t > 0)
        dynamoTimeoutSeconds = t;

    var dynamoConfig = new AmazonDynamoDBConfig
    {
        Timeout = TimeSpan.FromSeconds(dynamoTimeoutSeconds)
    };

    builder.Services.AddSingleton<IAmazonDynamoDB>(sp => new AmazonDynamoDBClient(dynamoConfig));
    builder.Services.AddSingleton<IEventStore>(sp =>
        new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
    builder.Services.AddSingleton<INoteTitleListStore>(sp =>
        new NoteTitleListStore(sp.GetRequiredService<IAmazonDynamoDB>(), projTableName));
    builder.Services.AddSingleton<NoteCommandHandler>();
    builder.Services.AddSingleton<IDynamoHealthCheck>(sp =>
        new DynamoDbHealthCheck(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
    builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);
    return builder;
}

static void AddEndpointMapping(WebApplication app)
{
    app.MapGet("/health", async (IDynamoHealthCheck dynamo) =>
    {
        var dh = await dynamo.CheckAsync();
        return Results.Ok(new
        {
            status = dh.Reachable ? "ok" : "degraded",
            dynamo = new { status = dh.Reachable ? "ok" : "error", error = dh.Error }
        });
    });
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

    app.MapGet("/notes", async (INoteTitleListStore projStore) =>
    {
        var view = await projStore.QueryAllAsync();
        return Results.Ok(new { items = view.Items.Select(i => new { noteId = i.NoteId.Value, title = i.Title }) });
    });
}

record CreateNoteRequest(Guid? NoteId);
record RenameNoteRequest(string Title);

public partial class Program { }
