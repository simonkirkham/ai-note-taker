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
            Summary: "We discussed the login bug.",
            DiscussionPoints: ["Login is broken"],
            Decisions: ["Fix it"],
            NewTags: ["login"],
            NewActionItems: ["Fix login bug"]));
        var judge = new StubJudge(allYes: true);
        var qualityJudge = new StubQualityJudge(score: 0.42);

        var row = await EvalRunner.RunAsync(
            fixture, PromptCatalog.V2, modelId: "amazon.nova-lite-v1:0",
            bedrock: bedrock, judge: judge, qualityJudge: qualityJudge, runId: "run-1",
            resultsDirectory: _resultsDir);

        Assert.Equal("test-fixture", row.FixtureId);
        Assert.Equal("amazon.nova-lite-v1:0", row.ModelId);
        Assert.Equal("analysis@v2", row.PromptVersion);
        Assert.Equal("run-1", row.RunId);
        Assert.Equal(1.0, row.FaithfulnessScore); // allYes judge → every claim "supported"
        Assert.Equal(0.42, row.Quality); // quality judge score flows through to the row
    }

    [Fact]
    public async Task Faithfulness_is_zero_when_no_claim_is_supported()
    {
        var fixture = new Fixture(
            Id: "unfaithful",
            TranscriptText: "Alice: nothing was decided.",
            ExistingContent: "Notes",
            CurrentUserName: "Alice",
            Expected: new FixtureExpected([], [], [])); // empty must-mention → content scores 1.0

        // Model invents claims the transcript doesn't support.
        var bedrock = new StubBedrock(new NoteAnalysisResult(
            Summary: "Big decisions were made.",
            DiscussionPoints: ["Budget doubled"],
            Decisions: ["Hire ten engineers"],
            NewTags: [],
            NewActionItems: ["Sign the lease"]));
        var judge = new StubJudge(allYes: false); // judge says nothing is supported

        var row = await EvalRunner.RunAsync(
            fixture, PromptCatalog.V2, "model-x", bedrock, judge, new StubQualityJudge(), "run-3", _resultsDir);

        Assert.Equal(0.0, row.FaithfulnessScore);
        Assert.Equal(1.0, row.ContentScore); // empty expected facts → recall vacuously 1.0
    }

    [Fact]
    public async Task Appends_one_jsonl_line_to_run_results_file()
    {
        var fixture = new Fixture("f1", "t", "c", "Alice",
            new FixtureExpected([], [], []));
        var bedrock = new StubBedrock(new NoteAnalysisResult("c", [], [], [], []));
        var judge = new StubJudge(allYes: true);

        await EvalRunner.RunAsync(fixture, PromptCatalog.V2, "model-x",
            bedrock, judge, new StubQualityJudge(), runId: "run-2", resultsDirectory: _resultsDir);

        var file = Path.Combine(_resultsDir, "run-2.jsonl");
        Assert.True(File.Exists(file));
        var lines = await File.ReadAllLinesAsync(file);
        Assert.Single(lines);
    }

    // MPI-5: the runner must hand the fixture's curated gold tags to the quality judge as
    // grounded entities so the judge cannot flag them as fabrication.
    [Fact]
    public async Task Passes_humanised_gold_tags_to_the_quality_judge_as_grounded_entities()
    {
        var fixture = new Fixture(
            Id: "14-all-hands-reorg",
            TranscriptText: "Yuki: reorg follow-up.",
            ExistingContent: "Stark Industries all-hands follow-up",
            CurrentUserName: "Yuki",
            Expected: new FixtureExpected(
                Tags: ["stark-industries", "all-hands"],
                ActionItems: [],
                ContentMustMention: []));
        var bedrock = new StubBedrock(new NoteAnalysisResult("s", [], [], [], []));
        var capturing = new CapturingQualityJudge();

        await EvalRunner.RunAsync(fixture, PromptCatalog.V2, "model-x",
            bedrock, new StubJudge(allYes: true), capturing, runId: "run-grounded", resultsDirectory: _resultsDir);

        Assert.NotNull(capturing.Last);
        Assert.Contains("stark industries", capturing.Last!.GroundedEntities);
        Assert.Contains("all hands", capturing.Last!.GroundedEntities);
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

    sealed class StubQualityJudge(double score = 0.5) : IQualityJudge
    {
        public Task<QualityScore> ScoreAsync(QualityJudgeInput input, CancellationToken ct = default)
            => Task.FromResult(new QualityScore(score, score, score, score, score, "stub"));
    }

    sealed class CapturingQualityJudge : IQualityJudge
    {
        public QualityJudgeInput? Last { get; private set; }

        public Task<QualityScore> ScoreAsync(QualityJudgeInput input, CancellationToken ct = default)
        {
            Last = input;
            return Task.FromResult(new QualityScore(0.5, 0.5, 0.5, 0.5, 0.5, "stub"));
        }
    }
}
