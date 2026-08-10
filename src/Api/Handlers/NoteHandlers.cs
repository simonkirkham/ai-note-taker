using System.Diagnostics;
using EventStore.Projections;
using Domain.Folders;
using Domain.Notes;
using Api.Auth;
using Api.Consistency;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using Api.HealthChecks;
using Api.Observability;
using Api.Search;
using Api.Utilities;
using Domain.Workspaces;
using EditContentCmd = Domain.Notes.EditContent;

namespace Api.Handlers;

public static class NoteHandlers
{
    private const int MaxPreviewLength = 120;

    // Read-your-writes (RYW-2): surface the note stream's new version as the write token so the
    // client can echo it into If-Consistent-With on its next note read, making that read wait
    // until the async projector has applied this write.
    private static void SetConsistencyToken(HttpResponse response, Guid noteId, long version) =>
        response.Headers["X-Consistency-Token"] = $"{new NoteId(noteId).ToStreamId()}@{version}";
    public static async Task<IResult> Health(IDynamoHealthCheck dynamo)
    {
        var dh = await dynamo.CheckAsync();
        return Results.Ok(new
        {
            status = dh.Reachable ? "ok" : "degraded",
            dynamo = new { status = dh.Reachable ? "ok" : "error", error = dh.Error }
        });
    }

    public static IResult Secret() => Results.Ok(new { status = "shhhh...." });

    public static async Task<IResult> CreateNote(HttpRequest request, HttpResponse response, INoteCommandHandler handler, ICurrentWorkspace currentWorkspace)
    {
        CreateNoteRequest? req = null;
        if (request.HasJsonContentType())
            req = await request.ReadFromJsonAsync<CreateNoteRequest>();
        var noteId = req?.NoteId is { } id && id != Guid.Empty ? new NoteId(id) : new NoteId(Guid.NewGuid());
        long version;
        try { version = await handler.HandleAsync(new CreateNote(noteId, new WorkspaceId(currentWorkspace.WorkspaceId))); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, noteId.Value, version);
        return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
    }

    public static async Task<IResult> RenameNote(Guid noteId, RenameNoteRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new RenameNote(new NoteId(noteId), req.Title)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        SetConsistencyToken(response, noteId, version);
        return Results.Ok();
    }

    public static async Task<IResult> ListNotes(INoteTitleListStore projStore, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace)
    {
        var view = await projStore.QueryAllAsync();
        var items = view.Items
            .Where(i => i.UserId == currentUser.UserId && currentWorkspace.Includes(i.WorkspaceId))
            .OrderByDescending(i => i.LastModifiedAt)
            .Select(i => new { noteId = i.NoteId.Value, title = i.Title, lastModifiedAt = i.LastModifiedAt });
        return Results.Ok(new { items });
    }

    // One helper, so the two 404 paths in EditContent are byte-identical by construction rather
    // than by two literals staying in step. Any divergence between them is an existence oracle.
    private static IResult NoteGone() => Results.NotFound(new { error = "note_not_found" });

    public static async Task<IResult> EditContent(Guid noteId, EditContentRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        // BUG-59: EVERY note-level 404 from this endpoint carries the same body, deliberately.
        // An earlier revision split "gone from the stream" (coded) from "not yours" (bare) so the
        // message would never be false. Review showed that hands back a reliable existence oracle:
        // `bare 404` would mean exactly "a live note with this id exists and is not yours". Not
        // leaking existence is the stronger property and is this path's stated intent, so the
        // not-yours case gets the identical response instead. The cost is telling an unauthorized
        // caller "deleted" about a note that exists — which is the same thing "not found" has always
        // told them, and they can have no legitimate copy of it open.
        // A legacy pre-Phase-8 note has no owner stamped, which NoteDetailProjection stores as "".
        // The command handler deliberately does NOT enforce ownership in that case, so neither can
        // this pre-check: `"" != currentUser.UserId` is true for EVERY caller, including the
        // rightful one. That mismatch predates BUG-59, but its blast radius did not — a bare 404
        // used to mean "try again", whereas note_not_found now latches the editor closed and
        // evicts the user home. Match the handler's escape hatch rather than inherit it.
        if (detail is not null && !string.IsNullOrEmpty(detail.UserId)
            && detail.UserId != currentUser.UserId) return NoteGone();
        long version;
        try { version = await handler.HandleAsync(new EditContentCmd(new NoteId(noteId), req.Content, req.ExpectedBaseContentHash)); }
        // The editor is open on a note deleted elsewhere, so every retry 404s (prod: six rejected
        // writes over 31 minutes). Terminal, not transient. The one 404 that stays BARE is an API
        // Gateway route miss falling through to `/{proxy+}` (shipped once in 34-B) — it never
        // reaches this handler and has no body — so a deploy skew can never tell a user their note
        // was deleted. Same discriminated-body convention as the 409 below.
        catch (NoteNotFoundException) { return NoteGone(); }
        // BUG-47: the client edited a stale/empty view whose base hash no longer matches the current
        // content. A terminal conflict — return 409 with a distinct code so the client keeps the typed
        // text, reloads the real content, and offers the typed text back (never a silent overwrite).
        catch (StaleContentEditException) { return Results.Conflict(new { error = "stale_content" }); }
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> GetNote(Guid noteId, INoteDetailStore noteDetailStore, ICalendarLinkIndexStore calendarLinkStore, ITranscriptionDraftStore draftStore, ICurrentUser currentUser, IConsistencyGate gate, ILoggerFactory loggerFactory, HttpContext http, CancellationToken ct)
    {
        // BUG-31 layer 3: the note-detail read sometimes leaves NoteView's Save button disabled
        // (`disabled={loadingDetail}`) for ~30s on reopen, hanging the E2E save click to its
        // actionability timeout. Code analysis bounds the read at ~7s (gate cap 2s + client gated
        // retries), so a 30s stall can only be a genuinely slow/missing projection in the deployed
        // env — invisible because GetNote had NO log line. Record per-read: the RYW gate outcome
        // (Proceed/Fresh/Stale), whether the projection row was found (hit / absent → 404 / wrong
        // owner → 404), and total latency. {Outcome}=Stale + {Result}=Absent that climbs to Hit on
        // a later attempt = a lagging projector; {Result}=Absent that persists = the write never
        // landed for this stream. No note content/title is logged (meeting notes are sensitive).
        var logger = loggerFactory.CreateLogger("Api.Handlers.NoteHandlers.Read");
        var stopwatch = Stopwatch.StartNew();
        var consistency = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (consistency.IsStale) http.Response.Headers["X-Consistency"] = "stale";

        // Single emit point so the two call sites (404 vs hit) can't drift the format apart.
        void LogRead(string result) => logger.LogInformation(
            "NoteDetail read {NoteId} outcome={Outcome} result={Result} latencyMs={LatencyMs}",
            noteId, consistency.Outcome, result, stopwatch.Elapsed.TotalMilliseconds);

        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId)
        {
            stopwatch.Stop();
            LogRead(detail is null ? "Absent" : "WrongOwner");
            return Results.NotFound();
        }
        var calendarLink = await calendarLinkStore.GetByNoteIdAsync(noteId.ToString());
        var linkedMeeting = calendarLink is null ? null : new
        {
            calendarEventId = calendarLink.CalendarEventId,
            title = calendarLink.CalendarEventTitle,
            startTime = calendarLink.StartTime,
            endTime = calendarLink.EndTime,
            recurringSeriesId = calendarLink.RecurringSeriesId,
            isRecurring = calendarLink.RecurringSeriesId is not null
        };
        // Compose an uncommitted transcription draft at read time (working state,
        // not a projection field — see ADR 0011). Suppress when the draft is a
        // prefix of / equal to the committed transcript (a stale draft left by a
        // failed post-commit delete), so only a genuinely interrupted recording
        // surfaces a recovery prompt.
        var draft = await draftStore.GetAsync(new NoteId(noteId));
        var transcriptDraft = draft is not null && IsUncommittedDraft(draft.Text, detail.TranscriptText)
            ? new { text = draft.Text, capturedAt = draft.CapturedAt }
            : null;
        stopwatch.Stop();
        LogRead("Hit");
        return Results.Ok(new
        {
            noteId = detail.NoteId.Value,
            title = detail.Title,
            content = detail.Content,
            date = detail.Date,
            tags = detail.Tags ?? [],
            createdAt = detail.CreatedAt,
            lastModifiedAt = detail.LastModifiedAt,
            transcriptText = detail.TranscriptText,
            transcriptDraft,
            recordingAudioKey = detail.RecordingAudioKey,
            transcriptIsDiarized = detail.TranscriptIsDiarized,
            summary = detail.Summary,
            discussionPoints = detail.DiscussionPoints ?? [],
            decisions = detail.Decisions ?? [],
            instructionResponses = (detail.InstructionResponses ?? [])
                .Select(r => new { instruction = r.Instruction, response = r.Response }),
            summaryModelId = detail.SummaryModelId,
            summaryPromptVersion = detail.SummaryPromptVersion,
            agenda = (detail.Agenda ?? [])
                .OrderBy(a => a.Position)
                .Select(a => new { itemId = a.ItemId, text = a.Text, discussed = a.Discussed, position = a.Position, derived = a.Derived }),
            recurringSeriesId = calendarLink?.RecurringSeriesId,
            isRecurring = calendarLink?.RecurringSeriesId is not null,
            linkedMeeting
        });
    }

    private static bool IsUncommittedDraft(string draftText, string? committedTranscript) =>
        !string.IsNullOrEmpty(draftText)
        && (string.IsNullOrEmpty(committedTranscript)
            || !committedTranscript.StartsWith(draftText, StringComparison.Ordinal));

    public static async Task<IResult> SetNoteDate(Guid noteId, SetNoteDateRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new SetNoteDate(new NoteId(noteId), req.Date)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        SetConsistencyToken(response, noteId, version);
        return Results.Ok();
    }

    public static async Task<IResult> DeleteNote(Guid noteId, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new Domain.Notes.DeleteNote(new NoteId(noteId))); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        // BUG-44: surface the delete's write token so the client can gate its cards refetch on the
        // projector applying NoteDeleted — otherwise the deleted card reappears from the stale projection.
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> PostTag(Guid noteId, TagNoteRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new TagNote(new NoteId(noteId), req.Tag)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> DeleteTag(Guid noteId, string tag, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new UntagNote(new NoteId(noteId), tag)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }





    public static async Task<IResult> MoveNoteToFolder(Guid noteId, MoveNoteToFolderRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        var targetId = new FolderId(req.FolderId);
        var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!allFolders.Any(f => f.FolderId == targetId && f.UserId == currentUser.UserId))
            return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new Domain.Notes.MoveNoteToFolder(new NoteId(noteId), targetId), ct); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        // BUG-45: surface the move's write token so the client can gate its cards refetch on the
        // projector applying the move (else the card's folder placement flickers back).
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> MoveNoteToWorkspace(Guid noteId, MoveNoteToWorkspaceRequest req, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, IWorkspaceListStore workspaceListStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        if (string.IsNullOrEmpty(req.WorkspaceId)) return Results.NotFound();
        // The default workspace is synthesised per user (never stored), so it skips the
        // ownership lookup — same rule as WorkspaceValidationFilter for the route param.
        if (req.WorkspaceId != WorkspaceId.DefaultValue)
        {
            var all = await workspaceListStore.GetAllAsync(ct).ConfigureAwait(false);
            if (!all.Any(w => w.WorkspaceId.Value == req.WorkspaceId && w.UserId == currentUser.UserId))
                return Results.NotFound();
        }
        long version;
        try { version = await handler.HandleAsync(new Domain.Notes.MoveNoteToWorkspace(new NoteId(noteId), new WorkspaceId(req.WorkspaceId)), ct); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        // BUG-45: surface the move's write token so the client can gate its cards refetch on the
        // projector applying the move — else the moved note reappears in the source workspace's list.
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> UnfileNote(Guid noteId, HttpResponse response, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is not null && detail.UserId != currentUser.UserId) return Results.NotFound();
        long version;
        try { version = await handler.HandleAsync(new Domain.Notes.UnfileNote(new NoteId(noteId)), ct); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        // BUG-45: surface the move's write token so the client can gate its cards refetch on the projector.
        SetConsistencyToken(response, noteId, version);
        return Results.NoContent();
    }

    public static async Task<IResult> LinkNoteToCalendar(Guid noteId, LinkNoteToCalendarRequest req, INoteCommandHandler handler, INoteCardListStore noteCardListStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var card = await noteCardListStore.GetByNoteAsync(new NoteId(noteId), ct);
        if (card is null || card.UserId != currentUser.UserId) return Results.NotFound();
        if (card.Deleted) return Results.Conflict();
        // Re-link is allowed (Phase 44): the same endpoint links a fresh note or moves an already-linked
        // note to a different meeting. The aggregate no-ops a re-link to the same meeting, so this is
        // idempotent and never conflicts on "already linked".
        try
        {
            await handler.HandleAsync(new LinkNoteToCalendarEvent(new NoteId(noteId),
                req.CalendarEventId, req.CalendarEventTitle, req.StartTime, req.EndTime,
                req.IsRecurring, req.RecurringSeriesId), ct);
        }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> UnlinkNoteFromCalendar(Guid noteId, INoteCommandHandler handler, INoteCardListStore noteCardListStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var card = await noteCardListStore.GetByNoteAsync(new NoteId(noteId), ct);
        if (card is null || card.UserId != currentUser.UserId) return Results.NotFound();
        if (card.Deleted) return Results.Conflict();
        // Idempotent (Phase 44-B): unlinking frees the linked meeting; unlinking a note
        // that is not currently linked is a no-op (the aggregate emits nothing), so a
        // repeat DELETE still returns 204.
        try
        {
            await handler.HandleAsync(new UnlinkNoteFromCalendarEvent(new NoteId(noteId)), ct);
        }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> SearchNotes(string? q, INoteSearchViewStore searchStore, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IDomainMetrics metrics, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q))
            return Results.Ok(new { items = Array.Empty<object>() });

        var stopwatch = Stopwatch.StartNew();
        var docs = await searchStore.QueryByUserIdAsync(currentUser.UserId, ct).ConfigureAwait(false);
        var searchable = docs.Where(d => !d.Deleted && currentWorkspace.Includes(d.WorkspaceId)).ToList();
        var ranked = NoteSearchRanker.Rank(q, searchable);
        stopwatch.Stop();

        metrics.SearchPerformed(ranked.Count, searchable.Count, stopwatch.Elapsed.TotalMilliseconds);

        var items = ranked.Select(r => new
        {
            noteId = r.View.NoteId.Value,
            title = r.View.Title,
            snippet = r.Snippet,
            score = r.Score,
            matchedField = r.MatchedField,
            matchedTerms = r.MatchedTerms
        });
        return Results.Ok(new { items });
    }

    public static async Task<IResult> GetNoteCards(INoteCardListStore store, ICurrentUser currentUser, ICurrentWorkspace currentWorkspace, IConsistencyGate gate, HttpContext http, CancellationToken ct)
    {
        // Read-your-writes: the cards list spans many note streams, but the client only holds a
        // token for the note it just wrote — the gate waits on that one stream's contribution
        // (the just-edited note's card) before answering. Absent token → no wait; timeout → stale.
        var consistency = await gate.WaitAsync(http.Request.Headers["If-Consistent-With"], ct).ConfigureAwait(false);
        if (consistency.IsStale) http.Response.Headers["X-Consistency"] = "stale";

        var all = await store.QueryAllAsync(ct).ConfigureAwait(false);
        var cards = all
            .Where(c => !c.Deleted && c.UserId == currentUser.UserId && currentWorkspace.Includes(c.WorkspaceId))
            .Select(MapCardToResponse);
        return Results.Ok(new { cards });
    }

    private static object MapCardToResponse(NoteCardView c)
    {
        var preview = BuildContentPreview(c.Content);
        var openActions = c.ActionItems
            .Where(a => !a.Completed)
            .Select(a => new { actionId = a.ActionId.Value, description = a.Description });
        return new
        {
            noteId = c.NoteId.Value,
            title = c.Title,
            contentPreview = preview,
            date = c.Date,
            tags = c.Tags ?? [],
            openActions,
            createdAt = c.CreatedAt,
            lastModifiedAt = c.LastModifiedAt,
            folderId = c.FolderId?.Value
        };
    }

    private static string BuildContentPreview(string content)
    {
        var stripped = MarkdownStripper.Strip(content);
        return stripped.Length > MaxPreviewLength
            ? stripped[..(MaxPreviewLength - 1)] + "…"
            : stripped;
    }
}
