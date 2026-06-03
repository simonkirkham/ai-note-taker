using System.Text;
using System.Text.Json;
using Analysis.Eval.Scoring;
using Api.Services;

namespace Analysis.Eval;

public sealed record EvalRow(
    string RunId,
    string FixtureId,
    string ModelId,
    string PromptVersion,
    double TagF1,
    double ActionF1,
    double ContentScore,
    double FaithfulnessScore,
    // Rubric-based holistic quality (the headline metric; the atomic scores above are
    // supplementary). Scored by a neutral judge against the user's stated preferences.
    double Quality,
    double QualityTags,
    double QualityActions,
    double QualityDecisions,
    double QualityContent,
    string QualityRationale = "");

public static class EvalRunner
{
    public const string EnvFlag = "RUN_BEDROCK_EVAL";

    public static bool IsEnabled => Environment.GetEnvironmentVariable(EnvFlag) == "1";

    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task<EvalRow> RunAsync(
        Fixture fixture,
        AnalysisPrompt prompt,
        string modelId,
        IBedrockAnalysisService bedrock,
        IJudgeClient judge,
        IQualityJudge qualityJudge,
        string runId,
        string resultsDirectory,
        CancellationToken ct = default)
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: fixture.ExistingContent,
            TranscriptText: fixture.TranscriptText,
            CurrentUserName: fixture.CurrentUserName);

        var result = await bedrock.AnalyseAsync(request, ct);
        var contentJudge = new ContentJudge(judge);

        var tag = TagScorer.Score(fixture.Expected.Tags, result.NewTags);
        var action = ActionItemScorer.Score(fixture.Expected.ActionItems, result.NewActionItems);

        // Content (recall): do the expected facts surface across the structured artifact?
        var summaryText = string.Join("\n", new[] { result.Summary }
            .Concat(result.DiscussionPoints)
            .Concat(result.Decisions));
        var contentScore = await contentJudge.ScoreAsync(summaryText, fixture.Expected.ContentMustMention, ct);

        // Faithfulness (precision): of the discrete claims the model asserted — discussion
        // points, decisions, action items — what fraction is actually supported by the
        // source (transcript + the user's existing note)? This is what the recall-only
        // Content score is blind to: a model that invents decisions/actions still scores
        // high on Content as long as it also includes the expected facts.
        var claims = result.DiscussionPoints
            .Concat(result.Decisions)
            .Concat(result.NewActionItems)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .ToList();
        var source = string.Join("\n", new[] { fixture.TranscriptText, fixture.ExistingContent }
            .Where(s => !string.IsNullOrWhiteSpace(s)));
        var faithfulness = await contentJudge.ScoreAsync(source, claims, ct);

        // Holistic quality against the user's rubric — the headline metric.
        var quality = await qualityJudge.ScoreAsync(new QualityJudgeInput(
            Transcript: fixture.TranscriptText,
            ExistingContent: fixture.ExistingContent,
            CurrentUserName: fixture.CurrentUserName,
            Summary: result.Summary,
            Discussion: result.DiscussionPoints,
            Decisions: result.Decisions,
            Tags: result.NewTags,
            Actions: result.NewActionItems), ct);

        var row = new EvalRow(
            RunId: runId,
            FixtureId: fixture.Id,
            ModelId: modelId,
            PromptVersion: prompt.Version,
            TagF1: tag.F1,
            ActionF1: action.F1,
            ContentScore: contentScore,
            FaithfulnessScore: faithfulness,
            Quality: quality.Overall,
            QualityTags: quality.Tags,
            QualityActions: quality.Actions,
            QualityDecisions: quality.Decisions,
            QualityContent: quality.Content,
            QualityRationale: quality.Rationale);

        // All rows in one process share {runId}.jsonl. The concurrent appends are
        // safe only because the assembly disables test parallelization (AssemblyInfo.cs);
        // re-enabling it would interleave lines and corrupt the jsonl.
        Directory.CreateDirectory(resultsDirectory);
        var file = Path.Combine(resultsDirectory, $"{runId}.jsonl");
        await File.AppendAllTextAsync(file, JsonSerializer.Serialize(row, JsonOptions) + "\n", ct);

        // Raw-output capture: the actual model output per case, so a low (or suspiciously
        // high) score can be eyeballed — "what did this model actually produce?" — rather
        // than trusted blind.
        var outputs = Path.Combine(resultsDirectory, $"{runId}-outputs.md");
        await File.AppendAllTextAsync(outputs, RenderOutput(result, row), ct);

        return row;
    }

    static string RenderOutput(NoteAnalysisResult result, EvalRow row)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"## {row.FixtureId} — {row.ModelId} [{row.PromptVersion}]");
        sb.AppendLine($"**Quality {row.Quality:F2}** (tags={row.QualityTags:F2} actions={row.QualityActions:F2} decisions={row.QualityDecisions:F2} content={row.QualityContent:F2}) — {row.QualityRationale}");
        sb.AppendLine($"_atomic: tagF1={row.TagF1:F2} · actionF1={row.ActionF1:F2} · content={row.ContentScore:F2} · faithfulness={row.FaithfulnessScore:F2}_");
        sb.AppendLine();
        sb.AppendLine($"**Summary:** {result.Summary}");
        sb.AppendLine();
        AppendList(sb, "Discussion", result.DiscussionPoints);
        AppendList(sb, "Decisions", result.Decisions);
        AppendList(sb, "Tags", result.NewTags);
        AppendList(sb, "Action items", result.NewActionItems);
        sb.AppendLine("---");
        sb.AppendLine();
        return sb.ToString();
    }

    static void AppendList(StringBuilder sb, string label, IReadOnlyList<string> items)
    {
        sb.AppendLine($"**{label}:**");
        if (items.Count == 0)
            sb.AppendLine("- _(none)_");
        else
            foreach (var item in items)
                sb.AppendLine($"- {item}");
        sb.AppendLine();
    }
}
