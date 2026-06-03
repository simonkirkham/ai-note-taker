using Analysis.Eval.Scoring;
using Api.Services;

namespace Analysis.Eval.Tests;

public class EvalRunnerTests : IDisposable
{
    readonly string _resultsDir;

    public EvalRunnerTests()
    {
        _resultsDir = Path.Combine(Path.GetTempPath(), "analysis-eval-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_resultsDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_resultsDir)) Directory.Delete(_resultsDir, recursive: true);
    }

    // Both env tests save and RESTORE the original flag value — not force it to null.
    // In the nightly run RUN_BEDROCK_EVAL=1, and forcing null here would make the
    // live matrix tests skip (a silent no-op eval), regardless of execution order.
    [Fact]
    public void Is_disabled_when_env_flag_is_unset()
    {
        var original = Environment.GetEnvironmentVariable(EvalRunner.EnvFlag);
        try
        {
            Environment.SetEnvironmentVariable(EvalRunner.EnvFlag, null);
            Assert.False(EvalRunner.IsEnabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(EvalRunner.EnvFlag, original);
        }
    }

    [Fact]
    public void Is_enabled_when_env_flag_is_one()
    {
        var original = Environment.GetEnvironmentVariable(EvalRunner.EnvFlag);
        try
        {
            Environment.SetEnvironmentVariable(EvalRunner.EnvFlag, "1");
            Assert.True(EvalRunner.IsEnabled);
        }
        finally
        {
            Environment.SetEnvironmentVariable(EvalRunner.EnvFlag, original);
        }
    }

    [Fact]
    public async Task Emits_a_results_row_with_fixture_model_and_prompt_identifiers()
    {
        var fixture = new Fixture(
            Id: "test-fixture",
            TranscriptText: "Alice will fix login bug",
            ExistingContent: "Notes",
            CurrentUserName: "Alice",
            Expected: new FixtureExpected(
                Tags: ["login"],
                ActionItems: ["Fix login bug"],
                ContentMustMention: []));

        var bedrock = new StubBedrock(new NoteAnalysisResult(
            UpdatedContent: "Updated notes",
            NewTags: ["login"],
            NewActionItems: ["Fix login bug"]));
        var judge = new StubJudge(allYes: true);

        var row = await EvalRunner.RunAsync(
            fixture, PromptCatalog.V1, modelId: "amazon.nova-lite-v1:0",
            bedrock: bedrock, judge: judge, runId: "run-1",
            resultsDirectory: _resultsDir);

        Assert.Equal("test-fixture", row.FixtureId);
        Assert.Equal("amazon.nova-lite-v1:0", row.ModelId);
        Assert.Equal("analysis@v1", row.PromptVersion);
        Assert.Equal("run-1", row.RunId);
    }

    [Fact]
    public async Task Appends_one_jsonl_line_to_run_results_file()
    {
        var fixture = new Fixture("f1", "t", "c", "Alice",
            new FixtureExpected([], [], []));
        var bedrock = new StubBedrock(new NoteAnalysisResult("c", [], []));
        var judge = new StubJudge(allYes: true);

        await EvalRunner.RunAsync(fixture, PromptCatalog.V1, "model-x",
            bedrock, judge, runId: "run-2", resultsDirectory: _resultsDir);

        var file = Path.Combine(_resultsDir, "run-2.jsonl");
        Assert.True(File.Exists(file));
        var lines = await File.ReadAllLinesAsync(file);
        Assert.Single(lines);
    }

    sealed class StubBedrock(NoteAnalysisResult next) : IBedrockAnalysisService
    {
        public Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default)
            => Task.FromResult(next);
    }

    sealed class StubJudge(bool allYes) : IJudgeClient
    {
        public Task<IReadOnlyList<bool>> RateAsync(
            string content, IReadOnlyList<string> facts, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<bool>>(
                Enumerable.Repeat(allYes, facts.Count).ToList());
    }
}
