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
    double ContentScore);

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
        string runId,
        string resultsDirectory,
        CancellationToken ct = default)
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: fixture.ExistingContent,
            TranscriptText: fixture.TranscriptText,
            CurrentUserName: fixture.CurrentUserName,
            AllowContentRewrite: true);

        var result = await bedrock.AnalyseAsync(request, ct);

        var tag = TagScorer.Score(fixture.Expected.Tags, result.NewTags);
        var action = ActionItemScorer.Score(fixture.Expected.ActionItems, result.NewActionItems);
        var contentScore = await new ContentJudge(judge)
            .ScoreAsync(result.UpdatedContent, fixture.Expected.ContentMustMention, ct);

        var row = new EvalRow(
            RunId: runId,
            FixtureId: fixture.Id,
            ModelId: modelId,
            PromptVersion: prompt.Version,
            TagF1: tag.F1,
            ActionF1: action.F1,
            ContentScore: contentScore);

        // All rows in one process share {runId}.jsonl. The concurrent appends are
        // safe only because the assembly disables test parallelization (AssemblyInfo.cs);
        // re-enabling it would interleave lines and corrupt the jsonl.
        Directory.CreateDirectory(resultsDirectory);
        var file = Path.Combine(resultsDirectory, $"{runId}.jsonl");
        await File.AppendAllTextAsync(file, JsonSerializer.Serialize(row, JsonOptions) + "\n", ct);

        return row;
    }
}
