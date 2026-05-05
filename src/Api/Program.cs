using Api.Endpoints;

var eventTableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");

var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

var app = Builder.BuildApp(args, eventTableName, projTableName);

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());

LoggingConfig.AddLogging(app);

// Endpoints are mapped in Api.Endpoints.NoteEndpoints
NoteEndpoints.MapNoteEndpoints(app);

app.Run();

public partial class Program { }
