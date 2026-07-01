using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using Api.Auth;
using Api.CommandHandlers;
using Api.Search;
using Api.Services;
using Api.Utilities;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;
using Domain.Workspaces;
using EventStore.Projections;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace Api.Mcp;

// 35-F: read-only MCP tools on the single identity-scoped /mcp endpoint. There is no workspace in the
// path; every workspace-scoped tool takes a workspaceId argument and authorizes it per call against
// the authenticated token's `sub` BEFORE returning data (Authorize). Reads are scoped by
// (userId=sub, workspaceId) so two users sharing the default workspace never see each other's notes.
// 41-A: write tools join the reads. Every tools/call hits one POST path, so the whole /mcp endpoint is
// now served by the Command Lambda (the sole holder of event-store access). Writes go through the
// command handlers' identity-explicit overloads (the token `sub` is the owner), never the store.
[McpServerToolType]
public sealed class NoteMcpTools(
    INoteCardListStore cards,
    INoteDetailStore details,
    INoteActionsStore actions,
    INoteSearchViewStore searchView,
    ITodoListStore todos,
    IFolderTreeStore folderTree,
    IWorkspaceListStore workspaces,
    INoteCommandHandler noteCommands,
    IActionItemCommandHandler actionCommands,
    IFolderCommandHandler folderCommands,
    INoteAuthorizer noteAuthorizer,
    IActionItemAuthorizer actionAuthorizer,
    ICalendarClientFactory calendarFactory,
    CalendarScope calendarScope,
    ICalendarLinkIndexStore calendarLinks,
    IHttpContextAccessor httpContextAccessor,
    ILogger<NoteMcpTools> logger)
{
    private const int MaxPreviewLength = 120;

    [McpServerTool(Name = "list_workspaces", ReadOnly = true)]
    [Description("List the caller's workspaces (id and name), including the default workspace, so a workspace can be resolved by name.")]
    public async Task<string> ListWorkspaces(CancellationToken ct)
    {
        var userId = AuthenticatedUserId();
        var all = await workspaces.GetAllAsync(ct).ConfigureAwait(false);
        var owned = all
            .Where(w => w.UserId == userId)
            .Select(w => new { id = w.WorkspaceId.Value, name = w.Name })
            .ToList();
        var result = new List<object> { new { id = WorkspaceId.DefaultValue, name = "Default" } };
        result.AddRange(owned);
        return JsonSerializer.Serialize(new { workspaces = result });
    }

    [McpServerTool(Name = "list_notes", ReadOnly = true)]
    [Description("List note cards in a workspace: id, title, date and a short content preview.")]
    public async Task<string> ListNotes(
        [Description("The workspace id to list notes from (use list_workspaces to resolve a name).")] string workspaceId,
        CancellationToken ct)
    {
        var userId = await AuthorizeAsync("list_notes", workspaceId, ct).ConfigureAwait(false);
        var all = await cards.QueryAllAsync(ct).ConfigureAwait(false);
        var notes = all
            .Where(c => !c.Deleted && c.UserId == userId && WorkspaceScopeExtensions.Matches(workspaceId, c.WorkspaceId))
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                id = c.NoteId.Value.ToString(),
                title = c.Title,
                date = c.Date?.ToString("yyyy-MM-dd"),
                preview = BuildPreview(c.Content)
            });
        return JsonSerializer.Serialize(new { notes });
    }

    [McpServerTool(Name = "get_note", ReadOnly = true)]
    [Description("Get a note's full content plus its action items. Rejects a note that is not in the given workspace.")]
    public async Task<string> GetNote(
        [Description("The workspace id the note belongs to.")] string workspaceId,
        [Description("The note id (a GUID) to fetch.")] string noteId,
        CancellationToken ct)
    {
        var userId = await AuthorizeAsync("get_note", workspaceId, ct).ConfigureAwait(false);
        if (!Guid.TryParse(noteId, out var guid))
            throw new McpException("Note not found.");
        var id = new NoteId(guid);

        var detail = await details.GetAsync(id, ct).ConfigureAwait(false);
        if (detail is null
            || detail.UserId != userId
            || !WorkspaceScopeExtensions.Matches(workspaceId, detail.WorkspaceId))
            throw new McpException("Note not found.");

        var noteActions = await actions.QueryByNoteAsync(id, ct).ConfigureAwait(false);
        return JsonSerializer.Serialize(new
        {
            id = detail.NoteId.Value.ToString(),
            title = detail.Title,
            date = detail.Date?.ToString("yyyy-MM-dd"),
            content = detail.Content,
            summary = detail.Summary,
            decisions = detail.Decisions,
            discussionPoints = detail.DiscussionPoints,
            tags = detail.Tags,
            actionItems = noteActions.Actions.Select(a => new
            {
                id = a.ActionId.Value.ToString(),
                description = a.Description,
                completed = a.Completed
            })
        });
    }

    [McpServerTool(Name = "search_notes", ReadOnly = true)]
    [Description("Fuzzy full-text search of the caller's notes in a workspace; returns ranked matches with a snippet.")]
    public async Task<string> SearchNotes(
        [Description("The workspace id to search within.")] string workspaceId,
        [Description("The search query.")] string query,
        CancellationToken ct)
    {
        var userId = await AuthorizeAsync("search_notes", workspaceId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(query))
            return JsonSerializer.Serialize(new { results = Array.Empty<object>() });

        var docs = await searchView.QueryByUserIdAsync(userId, ct).ConfigureAwait(false);
        var searchable = docs
            .Where(d => !d.Deleted && WorkspaceScopeExtensions.Matches(workspaceId, d.WorkspaceId))
            .ToList();
        var ranked = NoteSearchRanker.Rank(query, searchable);
        var results = ranked.Select(r => new
        {
            id = r.View.NoteId.Value.ToString(),
            title = r.View.Title,
            field = r.MatchedField,
            snippet = r.Snippet
        });
        return JsonSerializer.Serialize(new { results });
    }

    [McpServerTool(Name = "get_action_items", ReadOnly = true)]
    [Description("List the caller's open (incomplete) action items in a workspace.")]
    public async Task<string> GetActionItems(
        [Description("The workspace id to list open action items from.")] string workspaceId,
        CancellationToken ct)
    {
        var userId = await AuthorizeAsync("get_action_items", workspaceId, ct).ConfigureAwait(false);
        var view = await todos.QueryAllAsync(ct).ConfigureAwait(false);
        var items = view.Items
            .Where(i => i.UserId == userId && WorkspaceScopeExtensions.Matches(workspaceId, i.WorkspaceId))
            .Where(i => i.CompletedAt is null)
            .OrderByDescending(i => i.AddedAt)
            .Select(i => new
            {
                id = i.ItemId,
                description = i.Description,
                noteId = i.NoteId,
                noteTitle = i.NoteTitle
            });
        return JsonSerializer.Serialize(new { actionItems = items });
    }

    // 42-A: read a workspace's calendar. The calendar chain resolves its (user, workspace) from the
    // HTTP route, which the /mcp path lacks — so set the scoped CalendarScope to (sub, workspaceId)
    // before resolving the client. Authorizes workspace ownership first (meeting titles are sensitive).
    // calendar_unavailable (no connected calendar) is a normal result, not an error — mirrors the HTTP
    // GetMeetingsForDate. `timezone` only sets the day boundary; event times are absolute.
    [McpServerTool(Name = "list_meetings", ReadOnly = true)]
    [Description("List the caller's meetings in a workspace on a given date (yyyy-MM-dd). Shows title, time, and whether a note is already linked.")]
    public async Task<string> ListMeetings(
        [Description("The workspace id whose calendar to read (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The date to list meetings for, as yyyy-MM-dd.")] string date,
        // CancellationToken precedes the optional `timezone` so `timezone` can carry a C# default — the
        // MCP SDK keys a parameter's optionality off its default value, and the SDK injects the
        // CancellationToken by type regardless of position (it is never a tool argument).
        CancellationToken ct,
        [Description("Optional IANA timezone for the day boundary (e.g. Europe/London). Defaults to UTC.")] string? timezone = null)
    {
        var userId = await AuthorizeAsync("list_meetings", workspaceId, ct).ConfigureAwait(false);
        if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day))
            throw new McpException("Invalid date — expected yyyy-MM-dd.");
        var tz = string.IsNullOrWhiteSpace(timezone) ? "Etc/UTC" : timezone;
        try { TimeZoneInfo.FindSystemTimeZoneById(tz); }
        catch (TimeZoneNotFoundException) { throw new McpException($"Unknown timezone '{tz}'."); }

        var stopwatch = Stopwatch.StartNew();
        // Resolve the calendar for THIS (sub, workspaceId), not the route's default workspace.
        calendarScope.Set(userId, workspaceId);
        var calendar = await calendarFactory.ForAsync(workspaceId, ct).ConfigureAwait(false);
        var events = await calendar.GetEventsForDayAsync(day, tz).ConfigureAwait(false);
        if (events is null)
        {
            logger.LogInformation("mcp_read tool=list_meetings sub={Sub} workspaceId={WorkspaceId} provider={Provider} result=unavailable",
                userId, workspaceId, calendar.ProviderName);
            return JsonSerializer.Serialize(new { calendarConnected = false, provider = calendar.ProviderName, meetings = Array.Empty<object>() });
        }

        // Per-event linked-note lookup, scoped to the caller (a benign per-event failure → no link).
        var links = await Task.WhenAll(events.Select(async e =>
        {
            try { return await calendarLinks.GetByCalendarEventIdAsync(e.CalendarEventId, ct).ConfigureAwait(false); }
            catch { return null; }
        })).ConfigureAwait(false);
        var linkMap = links
            .Where(l => l is not null && l.UserId == userId)
            .ToDictionary(l => l!.CalendarEventId, l => l!.NoteId);

        var meetings = events.OrderBy(e => e.StartTime).Select(e => new
        {
            calendarEventId = e.CalendarEventId,
            title = e.Title,
            startTime = e.StartTime,
            endTime = e.EndTime,
            isRecurring = e.IsRecurring,
            recurringSeriesId = e.RecurringSeriesId,
            linkedNoteId = linkMap.GetValueOrDefault(e.CalendarEventId)
        }).ToList();
        logger.LogInformation("mcp_read tool=list_meetings sub={Sub} workspaceId={WorkspaceId} provider={Provider} count={Count} latencyMs={LatencyMs}",
            userId, workspaceId, calendar.ProviderName, meetings.Count, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { calendarConnected = true, provider = calendar.ProviderName, meetings });
    }

    // 42-B: calendar-linked note creation over MCP. Mirrors CalendarHandlers.CreateNoteFromMeeting /
    // CreateNoteFromNextOccurrence, but resolves identity from (sub, workspaceId) like list_meetings, not
    // the route. Authorizes workspace ownership first (a write into a foreign workspace is logged for
    // audit), conflict-checks the caller's own link (no duplicate note per (event, sub)), then creates +
    // dates + links via the identity-explicit overload. `alreadyExists` carries the existing noteId so a
    // reload is immediately actionable; the meeting fields come straight from list_meetings.
    [McpServerTool(Name = "create_note_from_meeting")]
    [Description("Create a note linked to a calendar meeting in a workspace the caller owns (pass the meeting fields from list_meetings). If a note already exists for that meeting, returns it instead of creating a duplicate.")]
    public async Task<string> CreateNoteFromMeeting(
        [Description("The workspace id (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The calendar event id, from list_meetings.")] string calendarEventId,
        [Description("The meeting title — becomes the note title.")] string title,
        [Description("The meeting start as ISO-8601, from list_meetings.")] string startTime,
        [Description("The meeting end as ISO-8601, from list_meetings.")] string endTime,
        CancellationToken ct,
        [Description("Whether the meeting recurs.")] bool isRecurring = false,
        [Description("The recurring series id, if any.")] string? recurringSeriesId = null)
    {
        var userId = await AuthorizeWriteAsync("create_note_from_meeting", workspaceId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(calendarEventId))
            throw new McpException("calendarEventId is required.");
        var start = ParseOffset(startTime, nameof(startTime));
        var end = ParseOffset(endTime, nameof(endTime));

        var existing = await ExistingLinkForCallerAsync(calendarEventId, userId, ct).ConfigureAwait(false);
        if (existing is not null)
            return await AlreadyExistsAsync(existing, ct).ConfigureAwait(false);

        var stopwatch = Stopwatch.StartNew();
        var (noteId, version) = await CreateLinkedNoteAsync(
            userId, workspaceId, calendarEventId, title, start, end, isRecurring, recurringSeriesId, ct).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=create_note_from_meeting sub={Sub} workspaceId={WorkspaceId} noteId={NoteId} calendarEventId={CalendarEventId} latencyMs={LatencyMs}",
            userId, workspaceId, noteId, calendarEventId, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { noteId, version, alreadyExists = false, calendarEventId, startTime = start, endTime = end });
    }

    // 42-B: resolves the next future occurrence of a recurring series off the route-explicit scope, then
    // creates + links a note for it. A series with no upcoming occurrence is a normal result
    // (noFutureOccurrence), not an error — same philosophy as 42-A's calendar_unavailable.
    [McpServerTool(Name = "create_note_from_next_occurrence")]
    [Description("Create a note linked to the next future occurrence of a recurring meeting series in a workspace the caller owns. Returns an existing note if one is already linked, or a clear no-future-occurrence result if the series has ended.")]
    public async Task<string> CreateNoteFromNextOccurrence(
        [Description("The workspace id (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The recurring series id, from list_meetings' recurringSeriesId.")] string recurringSeriesId,
        CancellationToken ct)
    {
        var userId = await AuthorizeWriteAsync("create_note_from_next_occurrence", workspaceId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(recurringSeriesId))
            throw new McpException("recurringSeriesId is required.");

        // Resolve the calendar for THIS (sub, workspaceId), not the route's default workspace.
        calendarScope.Set(userId, workspaceId);
        var calendar = await calendarFactory.ForAsync(workspaceId, ct).ConfigureAwait(false);
        var next = await calendar.GetNextOccurrenceAsync(recurringSeriesId, DateTimeOffset.UtcNow).ConfigureAwait(false);
        if (next is null)
        {
            logger.LogInformation("mcp_write tool=create_note_from_next_occurrence sub={Sub} workspaceId={WorkspaceId} recurringSeriesId={SeriesId} result=no_future_occurrence",
                userId, workspaceId, recurringSeriesId);
            return JsonSerializer.Serialize(new { noFutureOccurrence = true });
        }

        var existing = await ExistingLinkForCallerAsync(next.CalendarEventId, userId, ct).ConfigureAwait(false);
        if (existing is not null)
            return await AlreadyExistsAsync(existing, ct).ConfigureAwait(false);

        var stopwatch = Stopwatch.StartNew();
        var (noteId, version) = await CreateLinkedNoteAsync(
            userId, workspaceId, next.CalendarEventId, next.Title, next.StartTime, next.EndTime, next.IsRecurring, next.RecurringSeriesId, ct).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=create_note_from_next_occurrence sub={Sub} workspaceId={WorkspaceId} noteId={NoteId} calendarEventId={CalendarEventId} latencyMs={LatencyMs}",
            userId, workspaceId, noteId, next.CalendarEventId, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { noteId, version, alreadyExists = false, calendarEventId = next.CalendarEventId, startTime = next.StartTime, endTime = next.EndTime });
    }

    // 41-A: the first write tool. Authorizes workspace ownership (the same per-call check the reads
    // use), then creates the note via the command handler's identity-explicit overload so the token
    // `sub` is the stamped owner — title/content are applied as follow-up commands on the same stream,
    // mirroring the HTTP create flow (CreateNote → RenameNote → EditContent). Returns the new note id
    // and the stream version (the RYW write token); a subsequent read tool may briefly lag the async
    // projector before the note is visible.
    [McpServerTool(Name = "create_note")]
    [Description("Create a new note in a workspace the caller owns, with an optional title and content. Returns the new note id and stream version.")]
    public async Task<string> CreateNote(
        [Description("The workspace id to create the note in (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The note title. Optional if content is provided.")] string? title,
        [Description("The note body as markdown. Optional if a title is provided.")] string? content,
        CancellationToken ct)
    {
        // Authorize the workspace before mutating; the rejection is logged for audit (a write into a
        // foreign workspace mutates, not just leaks — never log any note content/title).
        var userId = await AuthorizeWriteAsync("create_note", workspaceId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(content))
            throw new McpException("Provide a title or content for the note.");

        // Three independent appends (CreateNote → RenameNote → EditContent), mirroring the HTTP flow's
        // non-atomicity: a fault after CreateNote lands leaves an orphaned partial note while the tool
        // returns an error. Accepted (same as the HTTP separate-call flow); the underlying command
        // handler surfaces a retriable 503 on persistent contention.
        var stopwatch = Stopwatch.StartNew();
        var noteId = new NoteId(Guid.NewGuid());
        await noteCommands.HandleAsync(new CreateNote(noteId, new WorkspaceId(workspaceId)), userId, workspaceId, ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(title))
            await noteCommands.HandleAsync(new RenameNote(noteId, title.Trim()), userId, workspaceId, ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(content))
            await noteCommands.HandleAsync(new EditContent(noteId, content), userId, workspaceId, ct).ConfigureAwait(false);

        // The flow appends across several handler calls, so read the final stream version for the RYW
        // write token (the Phase 38 import pattern), rather than the version of whichever command ran last.
        var version = await noteCommands.GetCurrentVersionAsync(noteId, ct).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=create_note sub={Sub} workspaceId={WorkspaceId} noteId={NoteId} latencyMs={LatencyMs}",
            userId, workspaceId, noteId.Value, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { noteId = noteId.Value.ToString(), version });
    }

    [McpServerTool(Name = "list_folders", ReadOnly = true)]
    [Description("List the folders in a workspace the caller owns — each folder's id, name, and parentId (null for a top-level folder). Use before filing a note or creating a subfolder.")]
    public async Task<string> ListFolders(
        [Description("The workspace id whose folders to list (use list_workspaces to resolve a name).")] string workspaceId,
        CancellationToken ct)
    {
        var userId = await AuthorizeAsync("list_folders", workspaceId, ct).ConfigureAwait(false);
        var all = await folderTree.GetAllAsync(ct).ConfigureAwait(false);
        var folders = all
            .Where(f => f.UserId == userId && WorkspaceScopeExtensions.Matches(workspaceId, f.WorkspaceId))
            .Select(f => new { id = f.FolderId.Value.ToString(), name = f.Name, parentId = f.ParentFolderId?.Value.ToString() })
            .ToList();
        return JsonSerializer.Serialize(new { folders });
    }

    [McpServerTool(Name = "create_folder")]
    [Description("Create a folder in a workspace the caller owns, optionally nested under a parent folder. Returns the new folder id and stream version.")]
    public async Task<string> CreateFolder(
        [Description("The workspace id to create the folder in (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The folder name.")] string name,
        CancellationToken ct,
        // CancellationToken precedes the optional `parentId` so it can carry a C# default (the MCP
        // binder treats a defaulted parameter as optional).
        [Description("Optional parent folder id to nest under (use list_folders to resolve). Omit for a top-level folder.")] string? parentId = null)
    {
        var userId = await AuthorizeWriteAsync("create_folder", workspaceId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(name))
            throw new McpException("Provide a folder name.");
        FolderId? parentFolderId = null;
        if (!string.IsNullOrWhiteSpace(parentId))
        {
            if (!Guid.TryParse(parentId, out var parentGuid))
                throw new McpException("Invalid parent folder id.");
            parentFolderId = new FolderId(parentGuid);
        }

        var folderId = new FolderId(Guid.NewGuid());
        long version;
        try
        {
            version = await folderCommands.HandleAsync(
                new Domain.Folders.CreateFolder(folderId, name.Trim(), parentFolderId, DateTimeOffset.UtcNow),
                userId, workspaceId, ct).ConfigureAwait(false);
        }
        catch (InvalidOperationException ex)
        {
            throw new McpException(ex.Message);
        }
        logger.LogInformation("mcp_write tool=create_folder sub={Sub} workspaceId={WorkspaceId} folderId={FolderId}",
            userId, workspaceId, folderId.Value);
        return JsonSerializer.Serialize(new { folderId = folderId.Value.ToString(), version });
    }

    [McpServerTool(Name = "move_note_to_folder")]
    [Description("File a note into a folder the caller owns (moving it there if it was in another folder). Both the note and the destination folder must belong to the caller. Returns the note's new stream version.")]
    public async Task<string> MoveNoteToFolder(
        [Description("The workspace id the note and folder are in (use list_workspaces to resolve a name).")] string workspaceId,
        [Description("The id of the note to file.")] string noteId,
        [Description("The id of the destination folder (use list_folders to resolve).")] string folderId,
        CancellationToken ct)
    {
        var userId = await AuthorizeWriteAsync("move_note_to_folder", workspaceId, ct).ConfigureAwait(false);
        if (!Guid.TryParse(noteId, out var noteGuid))
            throw new McpException("Invalid note id.");
        if (!Guid.TryParse(folderId, out var folderGuid))
            throw new McpException("Invalid folder id.");

        // The note is the mutated object — authorize its own owner from the event stream (BUG-30-safe),
        // like the other note write tools.
        var note = new NoteId(noteGuid);
        if (!await noteAuthorizer.OwnsNoteAsync(note, userId, ct).ConfigureAwait(false))
            throw new McpException("Note not found or access denied.");
        // The destination folder must belong to the caller in this workspace (mirrors the HTTP
        // file-in-folder check). Read model, matching HTTP; the event-stream folder authorizer lands in 47-C.
        var target = new FolderId(folderGuid);
        var folders = await folderTree.GetAllAsync(ct).ConfigureAwait(false);
        if (!folders.Any(f => f.FolderId == target && f.UserId == userId && WorkspaceScopeExtensions.Matches(workspaceId, f.WorkspaceId)))
            throw new McpException("Folder not found or access denied.");

        // Map retriable contention → a clear retry message (and a TOCTOU delete → not-found), matching
        // edit_note rather than leaking a generic invocation error (CLAUDE.md retriable-contention guardrail).
        var version = await RunNoteWriteAsync(
            () => noteCommands.HandleAsync(new Domain.Notes.MoveNoteToFolder(note, target), userId, workspaceId, ct)).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=move_note_to_folder sub={Sub} workspaceId={WorkspaceId} noteId={NoteId} folderId={FolderId}",
            userId, workspaceId, noteGuid, folderGuid);
        return JsonSerializer.Serialize(new { version });
    }

    // 41-B: action-item writes. add_action_item is NOTE-scoped (it attaches to a note), so it authorizes
    // note ownership (INoteAuthorizer, event-stream — BUG-30-safe). complete/reopen are ACTION-scoped:
    // they must prove ownership of the ACTION they mutate, not a caller-supplied note (authorizing an
    // arbitrary owned note while mutating a foreign action is an IDOR). So they authorize the action's
    // OWN owner (IActionItemAuthorizer, the UserId stamped on its first event) and take only the
    // actionId — the note is irrelevant. Rejections are logged for audit, like create_note.
    [McpServerTool(Name = "add_action_item")]
    [Description("Add an open action item (to-do) to a note the caller owns. Returns the new action item id.")]
    public async Task<string> AddActionItem(
        [Description("The id of the note to add the action item to (a GUID).")] string noteId,
        [Description("The action item description.")] string description,
        CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var (userId, note) = await AuthorizeOwnedNoteAsync("add_action_item", noteId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(description))
            throw new McpException("Provide a description for the action item.");

        var actionId = new ActionId(Guid.NewGuid());
        var version = await RunActionWriteAsync(
            () => actionCommands.HandleAsync(new AddActionItem(actionId, note, description.Trim()), userId, ct)).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=add_action_item sub={Sub} noteId={NoteId} actionId={ActionId} latencyMs={LatencyMs}",
            userId, note.Value, actionId.Value, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { actionId = actionId.Value.ToString(), version });
    }

    // 41-C: replace a note's body. Note-scoped, so it authorizes note ownership against the event
    // stream (same as add_action_item) and routes the EditContent command through the command handler's
    // identity-explicit overload (token `sub` = owner). Workspace is passed null: ContentEdited never
    // carries workspace — every note projection preserves the existing view's WorkspaceId on this fold.
    [McpServerTool(Name = "edit_note")]
    [Description("Replace the body content of a note the caller owns with new markdown. Returns the note's new stream version.")]
    public async Task<string> EditNote(
        [Description("The id of the note to edit (a GUID).")] string noteId,
        [Description("The new note body as markdown — replaces the existing content.")] string content,
        CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var (userId, note) = await AuthorizeOwnedNoteAsync("edit_note", noteId, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(content))
            throw new McpException("Provide content for the note (clearing a note is not supported).");

        // edit_note targets an EXISTING stream, so contention (a concurrent write) and a TOCTOU delete
        // (note removed between the ownership auth and the append) are both plausible — map them to
        // clean MCP errors instead of leaking a raw 503/500.
        var version = await RunNoteWriteAsync(
            () => noteCommands.HandleAsync(new EditContent(note, content), userId, null, ct)).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool=edit_note sub={Sub} noteId={NoteId} latencyMs={LatencyMs}",
            userId, note.Value, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { noteId = note.Value.ToString(), version });
    }

    [McpServerTool(Name = "complete_action_item")]
    [Description("Mark one of the caller's open action items as complete.")]
    public Task<string> CompleteActionItem(
        [Description("The action item id to complete (a GUID).")] string actionId,
        CancellationToken ct) =>
        MutateOwnedActionAsync("complete_action_item", actionId,
            (id, userId) => actionCommands.HandleAsync(new CompleteActionItem(id, DateTimeOffset.UtcNow), userId, ct), ct);

    [McpServerTool(Name = "reopen_action_item")]
    [Description("Reopen one of the caller's completed action items.")]
    public Task<string> ReopenActionItem(
        [Description("The action item id to reopen (a GUID).")] string actionId,
        CancellationToken ct) =>
        MutateOwnedActionAsync("reopen_action_item", actionId,
            (id, userId) => actionCommands.HandleAsync(new ReopenActionItem(id, DateTimeOffset.UtcNow), userId, ct), ct);

    // Resolves the token `sub` and authorizes ownership of an EXISTING note against the event stream
    // (BUG-30-safe) before a note-scoped write (add_action_item, edit_note). A non-GUID / unowned /
    // missing note is a logged MCP error. (create_note authorizes the workspace, not a note — it has
    // none yet.)
    private async Task<(string UserId, NoteId Note)> AuthorizeOwnedNoteAsync(string tool, string noteId, CancellationToken ct)
    {
        var userId = AuthenticatedUserId();
        if (!Guid.TryParse(noteId, out var guid) || !await noteAuthorizer.OwnsNoteAsync(new NoteId(guid), userId, ct).ConfigureAwait(false))
        {
            logger.LogWarning("mcp_write_rejected tool={Tool} sub={Sub} noteId={NoteId} reason=unauthorized", tool, userId, noteId);
            throw new McpException("Note not found or access denied.");
        }
        return (userId, new NoteId(guid));
    }

    // Authorizes the action's OWN owner (not a caller-supplied note) against the event stream, then
    // runs the mutation. A non-GUID / unowned / missing action is an MCP error, logged.
    private async Task<string> MutateOwnedActionAsync(string tool, string actionId, Func<ActionId, string, Task<long>> mutate, CancellationToken ct)
    {
        var stopwatch = Stopwatch.StartNew();
        var userId = AuthenticatedUserId();
        if (!Guid.TryParse(actionId, out var guid) || !await actionAuthorizer.OwnsActionAsync(new ActionId(guid), userId, ct).ConfigureAwait(false))
        {
            logger.LogWarning("mcp_write_rejected tool={Tool} sub={Sub} actionId={ActionId} reason=unauthorized", tool, userId, actionId);
            throw new McpException("Action item not found or access denied.");
        }
        var id = new ActionId(guid);
        var version = await RunActionWriteAsync(() => mutate(id, userId)).ConfigureAwait(false);
        logger.LogInformation("mcp_write tool={Tool} sub={Sub} actionId={ActionId} latencyMs={LatencyMs}",
            tool, userId, id.Value, stopwatch.Elapsed.TotalMilliseconds);
        return JsonSerializer.Serialize(new { actionId = id.Value.ToString(), version });
    }

    // Maps the aggregate's domain failures to clean MCP errors instead of a raw 500: a missing note or
    // action is not-found; an illegal transition (complete an already-complete item, reopen an open
    // one) is a conflict the client can interpret.
    private static async Task<long> RunActionWriteAsync(Func<Task<long>> write)
    {
        try { return await write().ConfigureAwait(false); }
        catch (Api.Exceptions.ActionItemNotFoundException) { throw new McpException("Action item not found."); }
        catch (Api.Exceptions.NoteNotFoundException) { throw new McpException("Note not found."); }
        catch (InvalidOperationException ex) { throw new McpException(ex.Message); }
    }

    // Same, for a note write: a TOCTOU-deleted note is not-found; persistent write contention is a
    // retriable conflict the client can interpret instead of a raw 503/500.
    private static async Task<long> RunNoteWriteAsync(Func<Task<long>> write)
    {
        try { return await write().ConfigureAwait(false); }
        catch (Api.Exceptions.NoteNotFoundException) { throw new McpException("Note not found."); }
        catch (WriteContentionException) { throw new McpException("The note is being modified concurrently — please retry."); }
    }

    // The authenticated user id (the token `sub`). JwtBearer's default inbound mapping turns `sub`
    // into ClaimTypes.NameIdentifier, but read both so the tool is robust to mapping being disabled.
    // No principal / no sub → an MCP error (the endpoint already 401s an unauthenticated request, so
    // this only fires if the policy is ever loosened).
    private string AuthenticatedUserId()
    {
        var ctx = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("No HTTP context.");
        var sub = ctx.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? ctx.User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
            throw new McpException("Not authenticated.");
        return sub;
    }

    // Per-call authorization (the security core). Returns the authenticated `sub` once it is confirmed
    // to own the requested workspace: the shared default workspace is always allowed; any other
    // workspace requires an IWorkspaceList membership row for (userId=sub, workspaceId). Failure throws
    // an McpException — the SDK returns a tool error result (isError), never data and never a 500.
    // The rejection is logged for audit (a cross-workspace read leaks sensitive data — meeting titles,
    // note content); mirror the write tools' mcp_write_rejected. Log the sub + attempted workspace only,
    // never any content.
    private async Task<string> AuthorizeAsync(string tool, string workspaceId, CancellationToken ct)
    {
        var userId = AuthenticatedUserId();
        if (!await UserOwnsWorkspaceAsync(userId, workspaceId, ct).ConfigureAwait(false))
        {
            logger.LogWarning("mcp_read_rejected tool={Tool} sub={Sub} workspaceId={WorkspaceId} reason=unauthorized",
                tool, userId, workspaceId);
            throw new McpException("Workspace not found or access denied.");
        }
        return userId;
    }

    private async Task<bool> UserOwnsWorkspaceAsync(string userId, string workspaceId, CancellationToken ct)
    {
        if (workspaceId == WorkspaceId.DefaultValue)
            return true;
        var all = await workspaces.GetAllAsync(ct).ConfigureAwait(false);
        return all.Any(w => w.WorkspaceId.Value == workspaceId && w.UserId == userId);
    }

    // Write-side authorization: like AuthorizeAsync but logs mcp_write_rejected (a write into a foreign
    // workspace mutates, not just leaks). Returns the authenticated sub once it owns the workspace.
    private async Task<string> AuthorizeWriteAsync(string tool, string workspaceId, CancellationToken ct)
    {
        var userId = AuthenticatedUserId();
        if (!await UserOwnsWorkspaceAsync(userId, workspaceId, ct).ConfigureAwait(false))
        {
            logger.LogWarning("mcp_write_rejected tool={Tool} sub={Sub} workspaceId={WorkspaceId} reason=unauthorized",
                tool, userId, workspaceId);
            throw new McpException("Workspace not found or access denied.");
        }
        return userId;
    }

    private static DateTimeOffset ParseOffset(string value, string field) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed)
            ? parsed
            : throw new McpException($"Invalid {field} — expected ISO-8601.");

    // The link index is keyed by calendar event id but holds links for ALL users; a note is a duplicate
    // only when the CALLER already owns one for the event (per the 9-D per-(event,sub) rule).
    private async Task<CalendarLinkView?> ExistingLinkForCallerAsync(string calendarEventId, string userId, CancellationToken ct)
    {
        var link = await calendarLinks.GetByCalendarEventIdAsync(calendarEventId, ct).ConfigureAwait(false);
        return link is not null && link.UserId == userId ? link : null;
    }

    // Reports the caller's existing note for an event instead of creating a duplicate. Echoes the times
    // from the stored link (authoritative), not the caller's input. The noteId rides the same payload so
    // a reload is immediately actionable; a malformed stored id degrades to version 0 rather than a 500.
    private async Task<string> AlreadyExistsAsync(CalendarLinkView link, CancellationToken ct)
    {
        var version = Guid.TryParse(link.NoteId, out var guid)
            ? await noteCommands.GetCurrentVersionAsync(new NoteId(guid), ct).ConfigureAwait(false)
            : 0;
        return JsonSerializer.Serialize(new
        {
            noteId = link.NoteId,
            version,
            alreadyExists = true,
            calendarEventId = link.CalendarEventId,
            startTime = link.StartTime,
            endTime = link.EndTime
        });
    }

    // The shared create flow (mirrors CalendarHandlers): CreateNote → RenameNote → SetNoteDate →
    // LinkNoteToCalendarEvent on one stream, via the identity-explicit overload so `sub` is the stamped
    // owner. The date is the meeting's start day (local, matching the HTTP handler). Non-atomic like the
    // HTTP flow — a fault mid-sequence leaves a partial note; the handler surfaces a retriable 503 on
    // persistent contention. Returns the new note id + final stream version (the RYW write token).
    private async Task<(string NoteId, long Version)> CreateLinkedNoteAsync(string userId, string workspaceId,
        string calendarEventId, string title, DateTimeOffset start, DateTimeOffset end, bool isRecurring,
        string? recurringSeriesId, CancellationToken ct)
    {
        var noteId = new NoteId(Guid.NewGuid());
        await noteCommands.HandleAsync(new CreateNote(noteId, new WorkspaceId(workspaceId)), userId, workspaceId, ct).ConfigureAwait(false);
        await noteCommands.HandleAsync(new RenameNote(noteId, title), userId, workspaceId, ct).ConfigureAwait(false);
        await noteCommands.HandleAsync(new SetNoteDate(noteId, DateOnly.FromDateTime(start.LocalDateTime)), userId, workspaceId, ct).ConfigureAwait(false);
        await noteCommands.HandleAsync(new LinkNoteToCalendarEvent(noteId, calendarEventId, title, start, end, isRecurring, recurringSeriesId), userId, workspaceId, ct).ConfigureAwait(false);
        var version = await noteCommands.GetCurrentVersionAsync(noteId, ct).ConfigureAwait(false);
        return (noteId.Value.ToString(), version);
    }

    private static string BuildPreview(string content)
    {
        var stripped = MarkdownStripper.Strip(content);
        return stripped.Length > MaxPreviewLength
            ? stripped[..MaxPreviewLength] + "…"
            : stripped;
    }
}
