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

    public static Task<EvalRow> RunAsync(
        Fixture fixture,
        AnalysisPrompt prompt,
        string modelId,
        IBedrockAnalysisService bedrock,
        Scoring.IJudgeClient judge,
        string runId,
        string resultsDirectory,
        CancellationToken ct = default)
    {
        throw new NotImplementedException(
            "Pip: build a NoteAnalysisRequest from the fixture (ExistingContent, TranscriptText, " +
            "CurrentUserName, AllowContentRewrite: true), call bedrock.AnalyseAsync(request), score the " +
            "result with TagScorer/ActionItemScorer/ContentJudge against fixture.Expected, append one row " +
            "to Results/<runId>.jsonl, and return the row carrying modelId + prompt.Version.");
    }
}
