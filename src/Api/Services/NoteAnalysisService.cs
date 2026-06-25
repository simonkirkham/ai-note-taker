using System.Diagnostics;
using System.Text.RegularExpressions;
using Amazon.BedrockRuntime;
using Domain.ActionItems;
using Domain.Notes;
using Api.CommandHandlers;
using Api.Observability;
using EventStore.Projections;
using Microsoft.Extensions.Logging;

namespace Api.Services;

// Extracted from TranscriptionHandlers.AnalyseNote (33-B2) so the same flow runs from the HTTP
// endpoint AND from the TranscribeCompletion Lambda after diarization — analyse exactly once, on
// the winning transcript. Persists via the command handlers' identity-explicit overloads (no scoped
// ICurrentUser). Carries the CHANGE-22 analysis metrics + per-note failure log unchanged.
public sealed class NoteAnalysisService(
    INoteCommandHandler noteHandler,
    IActionItemCommandHandler actionHandler,
    INoteDetailStore noteDetailStore,
    INoteActionsStore noteActionsStore,
    IBedrockAnalysisService bedrockAnalysis,
    IDomainMetrics metrics,
    ILogger<NoteAnalysisService> logger) : INoteAnalysisService
{
    // Images are stored and displayed but never analysed; strip the markdown image syntax so it
    // doesn't pollute the model prompt or burn tokens. Paren-free URLs (stable keys, never URLs).
    private static readonly Regex ImageMarkdown = new(@"!\[[^\]]*\]\([^)]*\)", RegexOptions.Compiled);
    private static string StripImageMarkdown(string content) => ImageMarkdown.Replace(content, "");

    public async Task<AnalysisOutcome> AnalyseAsync(NoteId noteId, string userId, string? workspaceId,
        string userName, string? transcriptOverride, CancellationToken ct = default)
    {
        var detail = await noteDetailStore.GetAsync(noteId, ct);
        // A freshly-imported transcript (Phase 38) is analysed in the SAME request it is created, so
        // the async projector has not built its NoteDetail row yet — a null projection with a
        // non-empty override is valid: analyse the override with empty content/tags. The recorded
        // path still requires the projection (null + no override = genuinely nothing to read).
        if (detail is null && string.IsNullOrWhiteSpace(transcriptOverride)) return AnalysisOutcome.NothingToAnalyse;

        // The transcript is the only field the diarization-completion caller has hotter than the
        // projection, so it may be overridden; content/tags/actions are warm in the projection.
        var transcript = transcriptOverride ?? detail?.TranscriptText;
        // The Bedrock prompt attributes action items to the current user by name. The HTTP caller
        // passes the live name; the async re-analysis (Lambda) has none, so fall back to the owner
        // name folded into the projection (stamped on the note's creation event) — 33-B2.
        var currentUserName = string.IsNullOrWhiteSpace(userName) ? detail?.OwnerName ?? "" : userName;
        var (rawContent, instructions) = InstructionExtractor.Extract(detail?.Content ?? "");
        var content = StripImageMarkdown(rawContent);
        if (string.IsNullOrWhiteSpace(transcript) && string.IsNullOrWhiteSpace(content) && instructions.Count == 0)
            return AnalysisOutcome.NothingToAnalyse;

        NoteAnalysisResult result;
        // Time just the Bedrock inference — the dominant, variable cost. On failure emit the
        // alarmable AnalysisFailed metric and log the note id (id in the log, not a metric dimension).
        var analysisStopwatch = Stopwatch.StartNew();
        try
        {
            result = await bedrockAnalysis.AnalyseAsync(
                new NoteAnalysisRequest(content, transcript, currentUserName, instructions), ct);
            metrics.AnalysisCompleted(analysisStopwatch.Elapsed.TotalMilliseconds);
        }
        catch (Exception ex) when (ex is AmazonBedrockRuntimeException or InvalidOperationException)
        {
            metrics.AnalysisFailed();
            logger.LogError(ex, "Analysis failed for note {NoteId} after {ElapsedMs}ms: {ExceptionType} {Message}",
                noteId.Value, analysisStopwatch.Elapsed.TotalMilliseconds, ex.GetType().Name, ex.Message);
            return AnalysisOutcome.ServiceUnavailable;
        }

        await noteHandler.HandleAsync(new RecordAnalysisSummary(
            noteId, result.Summary, result.DiscussionPoints, result.Decisions,
            result.ModelId, result.PromptVersion), userId, workspaceId, ct);

        var instructionResponses = result.InstructionResponses ?? [];
        if (instructions.Count > instructionResponses.Count)
            logger.LogWarning(
                "Instruction responses missing: {Extracted} /ai instruction(s) extracted but model returned {Returned} response(s) for note {NoteId}",
                instructions.Count, instructionResponses.Count, noteId.Value);
        // Record when there is something to show, or to CLEAR previously-recorded responses on a
        // re-run that no longer has any (latest wins). A note that never had instructions writes none.
        var hadResponses = (detail?.InstructionResponses?.Count ?? 0) > 0;
        if (instructionResponses.Count > 0 || hadResponses)
            await noteHandler.HandleAsync(new RecordInstructionResponses(
                noteId, instructionResponses, result.ModelId, result.PromptVersion), userId, workspaceId, ct);

        var existingTags = detail?.Tags ?? [];
        var appliedTags = result.NewTags
            .Where(t => !existingTags.Contains(t, StringComparer.OrdinalIgnoreCase))
            .ToList();
        if (appliedTags.Count > 0)
            await noteHandler.HandleAsync(new RecordTagSuggestions(noteId, appliedTags, result.ModelId, result.PromptVersion), userId, workspaceId, ct);
        foreach (var tag in appliedTags)
            await noteHandler.HandleAsync(new TagNote(noteId, tag), userId, workspaceId, ct);

        var existingActionsView = await noteActionsStore.QueryByNoteAsync(noteId, ct);
        var existingDescriptions = existingActionsView.Actions
            .Select(a => a.Description)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var createdActionIds = new List<Guid>();
        foreach (var action in result.NewActionItems.Where(a => !existingDescriptions.Contains(a)))
        {
            var actionId = Guid.NewGuid();
            await actionHandler.HandleAsync(new AddActionItem(new ActionId(actionId), noteId, action), userId, ct);
            createdActionIds.Add(actionId);
        }
        if (createdActionIds.Count > 0)
            await noteHandler.HandleAsync(new RecordActionItemSuggestions(noteId, createdActionIds, result.ModelId, result.PromptVersion), userId, workspaceId, ct);

        return AnalysisOutcome.Analysed;
    }
}
