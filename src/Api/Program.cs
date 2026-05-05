using Amazon.DynamoDBv2;
using Api;
using Api.Endpoints;
using Domain.Notes;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Mvc;

var eventTableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");

var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

var app = Builder.BuildApp(args, eventTableName, projTableName);

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());

AddLogging(app);

app.Services.GetRequiredService<IEventStore>();
app.Services.GetRequiredService<NoteCommandHandler>();

// Endpoints are mapped in Api.Endpoints.NoteEndpoints
NoteEndpoints.MapNoteEndpoints(app);

app.Run();

static void AddLogging(WebApplication app)
{
    app.UseExceptionHandler(exApp => exApp.Run(async ctx =>
    {
        var ex = ctx.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
        var log = ctx.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("Api");
        log.LogError(ex, "Unhandled exception on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
        ctx.Response.StatusCode = 500;
        await ctx.Response.WriteAsJsonAsync(new { error = "internal server error" });
    }));
}

public partial class Program { }
