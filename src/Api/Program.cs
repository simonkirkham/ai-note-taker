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

var tagFeedbackTableName = Environment.GetEnvironmentVariable("PROJ_TAGFEEDBACK_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_TAGFEEDBACK_TABLE_NAME is not set.");

var actionFeedbackTableName = Environment.GetEnvironmentVariable("PROJ_ACTIONFEEDBACK_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_ACTIONFEEDBACK_TABLE_NAME is not set.");

var calendarLinkTableName = Environment.GetEnvironmentVariable("PROJ_CALENDARLINKINDEX_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_CALENDARLINKINDEX_TABLE_NAME is not set.");

var noteSearchViewTableName = Environment.GetEnvironmentVariable("PROJ_NOTESEARCHVIEW_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_NOTESEARCHVIEW_TABLE_NAME is not set.");

var draftTranscriptionTableName = Environment.GetEnvironmentVariable("DRAFT_TRANSCRIPTION_TABLE_NAME")
    ?? throw new InvalidOperationException("DRAFT_TRANSCRIPTION_TABLE_NAME is not set.");

var workspaceListTableName = Environment.GetEnvironmentVariable("PROJ_WORKSPACELIST_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_WORKSPACELIST_TABLE_NAME is not set.");

var projPositionTableName = Environment.GetEnvironmentVariable("PROJ_POSITION_TABLE_NAME")
    ?? throw new InvalidOperationException("PROJ_POSITION_TABLE_NAME is not set.");

var authTokensTableName = Environment.GetEnvironmentVariable("AUTH_TOKENS_TABLE_NAME")
    ?? throw new InvalidOperationException("AUTH_TOKENS_TABLE_NAME is not set.");

var calendarTokensTableName = Environment.GetEnvironmentVariable("CALENDAR_TOKENS_TABLE_NAME")
    ?? throw new InvalidOperationException("CALENDAR_TOKENS_TABLE_NAME is not set.");

var app = Builder.BuildApp(args, eventTableName, projTableName, noteDetailTableName, noteActionsTableName, todoListTableName, noteCardListTableName, folderTreeTableName, tagIndexTableName, tagFeedbackTableName, actionFeedbackTableName, calendarLinkTableName, noteSearchViewTableName, draftTranscriptionTableName, workspaceListTableName, projPositionTableName, authTokensTableName, calendarTokensTableName);

LoggingConfig.UseCorrelationId(app);

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseMiddleware<Api.Mcp.McpAllowlistMiddleware>();
app.UseAuthentication();
app.UseMiddleware<Api.Auth.AllowlistMiddleware>();
app.UseAuthorization();

LoggingConfig.AddLogging(app);

NoteEndpoints.MapNoteEndpoints(app);
app.MapFolderEndpoints();
app.MapAuthEndpoints();
app.MapCalendarEndpoints();
app.MapCalendarAuthEndpoints();
app.MapTranscriptionEndpoints();
app.MapTodoEndpoints();
app.MapWorkspaceEndpoints();

// 35-A: read-only MCP server, mapped OUTSIDE the WorkspaceValidationFilter/RequireAuthorization
// group — no auth this slice. The {workspaceId} route value scopes list_notes (read via
// IHttpContextAccessor). Tool calls are read-only, so this path is pinned to the Query Lambda in
// API Gateway (see NoteTakerStack).
app.MapMcp("/w/{workspaceId}/mcp");

Builder.RegisterSnapStartPriming(app);

app.Run();

public partial class Program { }
