using Api;
using Api.Endpoints;

var eventTableName = Environment.GetEnvironmentVariable("EVENTS_TABLE_NAME")
    ?? throw new InvalidOperationException("EVENTS_TABLE_NAME is not set.");

var projTableName = Environment.GetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTETITLELIST_TABLE_NAME is not set.");

var noteDetailTableName = Environment.GetEnvironmentVariable("PROJ_NOTEDETAIL_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTEDETAIL_TABLE_NAME is not set.");

var noteActionsTableName = Environment.GetEnvironmentVariable("PROJ_NOTEACTIONS_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTEACTIONS_TABLE_NAME is not set.");

var todoListTableName = Environment.GetEnvironmentVariable("PROJ_TODOLIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_TODOLIST_TABLE_NAME is not set.");

var noteCardListTableName = Environment.GetEnvironmentVariable("PROJ_NOTECARDLIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTECARDLIST_TABLE_NAME is not set.");

var folderTreeTableName = Environment.GetEnvironmentVariable("PROJ_FOLDERTREE_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_FOLDERTREE_TABLE_NAME is not set.");

var tagIndexTableName = Environment.GetEnvironmentVariable("PROJ_TAGINDEX_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_TAGINDEX_TABLE_NAME is not set.");

var app = Builder.BuildApp(args, eventTableName, projTableName, noteDetailTableName, noteActionsTableName, todoListTableName, noteCardListTableName, folderTreeTableName, tagIndexTableName);

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseAuthentication();
app.UseMiddleware<Api.Auth.AllowlistMiddleware>();
app.UseAuthorization();

LoggingConfig.AddLogging(app);

NoteEndpoints.MapNoteEndpoints(app);
app.MapFolderEndpoints();
app.MapAuthEndpoints();

app.Run();

public partial class Program { }
