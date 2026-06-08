using System.Diagnostics;
using EventStore.Projections;
using Domain.Folders;
using Domain.Notes;
using Api.Auth;
using Api.Contracts;
using Api.CommandHandlers;
using Api.Exceptions;
using Api.HealthChecks;
using Api.Observability;
using Api.Search;
using Api.Utilities;
using EditContentCmd = Domain.Notes.EditContent;

namespace Api.Handlers;

public static class NoteHandlers
{
    private const int MaxPreviewLength = 120;
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

    public static async Task<IResult> CreateNote(HttpRequest request, INoteCommandHandler handler)
    {
        CreateNoteRequest? req = null;
        if (request.HasJsonContentType())
            req = await request.ReadFromJsonAsync<CreateNoteRequest>();
        var noteId = req?.NoteId is { } id && id != Guid.Empty ? new NoteId(id) : new NoteId(Guid.NewGuid());
        try { await handler.HandleAsync(new CreateNote(noteId)); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.Created($"/notes/{noteId}", new { noteId = noteId.Value });
    }

    public static async Task<IResult> RenameNote(Guid noteId, RenameNoteRequest req, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new RenameNote(new NoteId(noteId), req.Title)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.Ok();
    }

    public static async Task<IResult> ListNotes(INoteTitleListStore projStore, ICurrentUser currentUser)
    {
        var view = await projStore.QueryAllAsync();
        var items = view.Items
            .Where(i => i.UserId == currentUser.UserId)
            .OrderByDescending(i => i.LastModifiedAt)
            .Select(i => new { noteId = i.NoteId.Value, title = i.Title, lastModifiedAt = i.LastModifiedAt });
        return Results.Ok(new { items });
    }

    public static async Task<IResult> EditContent(Guid noteId, EditContentRequest req, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new EditContentCmd(new NoteId(noteId), req.Content)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> GetNote(Guid noteId, INoteDetailStore noteDetailStore, ICalendarLinkIndexStore calendarLinkStore, ITranscriptionDraftStore draftStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
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
            summary = detail.Summary,
            discussionPoints = detail.DiscussionPoints ?? [],
            decisions = detail.Decisions ?? [],
            summaryModelId = detail.SummaryModelId,
            summaryPromptVersion = detail.SummaryPromptVersion,
            recurringSeriesId = calendarLink?.RecurringSeriesId,
            isRecurring = calendarLink?.RecurringSeriesId is not null,
            linkedMeeting
        });
    }

    private static bool IsUncommittedDraft(string draftText, string? committedTranscript) =>
        !string.IsNullOrEmpty(draftText)
        && (string.IsNullOrEmpty(committedTranscript)
            || !committedTranscript.StartsWith(draftText, StringComparison.Ordinal));

    public static async Task<IResult> SetNoteDate(Guid noteId, SetNoteDateRequest req, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new SetNoteDate(new NoteId(noteId), req.Date)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.Ok();
    }

    public static async Task<IResult> DeleteNote(Guid noteId, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new Domain.Notes.DeleteNote(new NoteId(noteId))); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> PostTag(Guid noteId, TagNoteRequest req, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new TagNote(new NoteId(noteId), req.Tag)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.NoContent();
    }

    public static async Task<IResult> DeleteTag(Guid noteId, string tag, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new UntagNote(new NoteId(noteId), tag)); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> MoveNoteToFolder(Guid noteId, MoveNoteToFolderRequest req, INoteCommandHandler handler, INoteDetailStore noteDetailStore, IFolderTreeStore folderTreeStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        var targetId = new FolderId(req.FolderId);
        var allFolders = await folderTreeStore.GetAllAsync(ct).ConfigureAwait(false);
        if (!allFolders.Any(f => f.FolderId == targetId && f.UserId == currentUser.UserId))
            return Results.NotFound();
        try { await handler.HandleAsync(new Domain.Notes.MoveNoteToFolder(new NoteId(noteId), targetId), ct); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> UnfileNote(Guid noteId, INoteCommandHandler handler, INoteDetailStore noteDetailStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var detail = await noteDetailStore.GetAsync(new NoteId(noteId));
        if (detail is null || detail.UserId != currentUser.UserId) return Results.NotFound();
        try { await handler.HandleAsync(new Domain.Notes.UnfileNote(new NoteId(noteId)), ct); }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        return Results.NoContent();
    }

    public static async Task<IResult> LinkNoteToCalendar(Guid noteId, LinkNoteToCalendarRequest req, INoteCommandHandler handler, INoteCardListStore noteCardListStore, ICurrentUser currentUser, CancellationToken ct)
    {
        var card = await noteCardListStore.GetByNoteAsync(new NoteId(noteId), ct);
        if (card is null || card.UserId != currentUser.UserId) return Results.NotFound();
        if (card.Deleted) return Results.Conflict();
        try
        {
            await handler.HandleAsync(new LinkNoteToCalendarEvent(new NoteId(noteId),
                req.CalendarEventId, req.CalendarEventTitle, req.StartTime, req.EndTime,
                req.IsRecurring, req.RecurringSeriesId), ct);
        }
        catch (NoteNotFoundException) { return Results.NotFound(); }
        catch (InvalidOperationException) { return Results.Conflict(); }
        return Results.NoContent();
    }

    public static async Task<IResult> SearchNotes(string? q, INoteSearchViewStore searchStore, ICurrentUser currentUser, IDomainMetrics metrics, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(q))
            return Results.Ok(new { items = Array.Empty<object>() });

        var stopwatch = Stopwatch.StartNew();
        var docs = await searchStore.QueryByUserIdAsync(currentUser.UserId, ct).ConfigureAwait(false);
        var searchable = docs.Where(d => !d.Deleted).ToList();
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

    public static async Task<IResult> GetNoteCards(INoteCardListStore store, ICurrentUser currentUser, CancellationToken ct)
    {
        var all = await store.QueryAllAsync(ct).ConfigureAwait(false);
        var cards = all
            .Where(c => !c.Deleted && c.UserId == currentUser.UserId)
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
