using Api;
using Api.Endpoints;
using Api.Mcp.OAuth;

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

var mcpAuthCodeTableName = Environment.GetEnvironmentVariable("MCP_AUTH_CODE_TABLE_NAME")
    ?? throw new InvalidOperationException("MCP_AUTH_CODE_TABLE_NAME is not set.");

var mcpRefreshTokenTableName = Environment.GetEnvironmentVariable("MCP_REFRESH_TOKEN_TABLE_NAME")
    ?? throw new InvalidOperationException("MCP_REFRESH_TOKEN_TABLE_NAME is not set.");

var app = Builder.BuildApp(args, eventTableName, projTableName, noteDetailTableName, noteActionsTableName, todoListTableName, noteCardListTableName, folderTreeTableName, tagIndexTableName, tagFeedbackTableName, actionFeedbackTableName, calendarLinkTableName, noteSearchViewTableName, draftTranscriptionTableName, workspaceListTableName, projPositionTableName, authTokensTableName, calendarTokensTableName, mcpAuthCodeTableName, mcpRefreshTokenTableName);

LoggingConfig.UseCorrelationId(app);

app.UseCors(p => p.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());
app.UseMiddleware<Api.Mcp.McpAllowlistMiddleware>();
app.UseAuthentication();
app.UseMiddleware<Api.Auth.AllowlistMiddleware>();
app.UseAuthorization();
// 35-E: bind an authenticated MCP request's token `aud` to the route workspace (403 on a cross-
// workspace token), covering EVERY MCP method — runs after authentication so the principal is set.
app.UseMiddleware<Api.Mcp.OAuth.McpAudienceMiddleware>();

LoggingConfig.AddLogging(app);

NoteEndpoints.MapNoteEndpoints(app);
app.MapFolderEndpoints();
app.MapAuthEndpoints();
app.MapCalendarEndpoints();
app.MapCalendarAuthEndpoints();
app.MapTranscriptionEndpoints();
app.MapTodoEndpoints();
app.MapWorkspaceEndpoints();
// 35-E: MCP OAuth 2.1 Authorization Server + metadata endpoints (Command Lambda — they need the
// Google client + the HMAC secret). The Resource Server half (token validation + the protected-
// resource metadata/challenge) is wired in Builder via AddMcpOAuth and applied to MapMcp below.
app.MapMcpOAuthEndpoints();

// 35-A: read-only MCP server, mapped OUTSIDE the WorkspaceValidationFilter/RequireAuthorization
// group — no auth this slice. The {workspaceId} route value scopes list_notes (read via
// IHttpContextAccessor). Tool calls are read-only, so this path is pinned to the Query Lambda in
// API Gateway (see NoteTakerStack).
// Kill switch: the no-auth endpoint is disabled in prod (MCP_ENABLED=false) until 35-E adds
// OAuth. Defaults ON so tests/local keep it mapped; prod sets it OFF. When unmapped, ASP.NET has
// no matching endpoint (there is no MapFallback) so the API-Gateway-forwarded POST gets a genuine
// 404 — not a 500 or a fallthrough that still serves.
// 35-E: the MCP tool endpoint now REQUIRES an audience-bound bearer carrying the mcp:tools scope.
// RequireAuthorization wires the McpToolPolicy (→ McpBearer HS256 validation + scope check); a
// missing/invalid token yields 401 with the WWW-Authenticate: Bearer resource_metadata challenge,
// and a token without the scope yields 403. McpAudienceMiddleware then enforces the EXACT
// token-aud↔route-workspace binding (→ 403 on a cross-workspace token) for EVERY MCP method
// (initialize/tools/list/tools/call), not just the tool body. The MCP_ENABLED gate (re-enabled in
// prod for 35-E) and the McpAllowlistMiddleware both still apply.
if (app.Configuration.GetValue("MCP_ENABLED", true))
    app.MapMcp("/w/{workspaceId}/mcp").RequireAuthorization(Api.Mcp.OAuth.McpAuthWiring.ToolPolicy);

Builder.RegisterSnapStartPriming(app);

app.Run();

public partial class Program { }
