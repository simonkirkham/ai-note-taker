using Amazon.Runtime;
using Analysis.Eval.Scoring;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit.Abstractions;

namespace Analysis.Eval.Tests;

// The live eval matrix. Opt-in: every case is skipped unless RUN_BEDROCK_EVAL=1,
// so PR CI never burns Bedrock credit. Runs locally or nightly with AWS creds set.
public class BedrockEvalTheory
{
    // A single run id groups all rows produced in one process into one results file.
    static readonly string RunId = $"run-{Environment.ProcessId}";

    static readonly string[] Models = (Environment.GetEnvironmentVariable("EVAL_MODEL_IDS")
            ?? "amazon.nova-lite-v1:0")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    // Prompts swept per model. Defaults to the recent set [V3, V4, V5]; EVAL_PROMPT_VERSIONS
    // (comma-separated, e.g. "analysis@v5") narrows it — mirrors EVAL_MODEL_IDS so a model-only
    // sweep (MPI-3) doesn't have to re-run every prompt. An unknown version id is ignored; if
    // the override resolves to nothing, fall back to the default set rather than an empty matrix.
    static readonly AnalysisPrompt[] DefaultPrompts = [PromptCatalog.V3, PromptCatalog.V4, PromptCatalog.V5];

    static readonly AnalysisPrompt[] AllPrompts =
        [PromptCatalog.V1, PromptCatalog.V2, PromptCatalog.V3, PromptCatalog.V4, PromptCatalog.V5, PromptCatalog.V6];

    static readonly AnalysisPrompt[] Prompts = ResolvePrompts();

    static AnalysisPrompt[] ResolvePrompts()
    {
        var requested = (Environment.GetEnvironmentVariable("EVAL_PROMPT_VERSIONS") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (requested.Length == 0)
            return DefaultPrompts;

        var selected = AllPrompts
            .Where(p => requested.Contains(p.Version, StringComparer.OrdinalIgnoreCase))
            .ToArray();
        return selected.Length > 0 ? selected : DefaultPrompts;
    }

    static string ResultsDirectory =>
        Path.Combine(AppContext.BaseDirectory, "Results");

    // Where fixtures are loaded from. Defaults to the committed corpus copied next to the
    // test binary; EVAL_FIXTURES_DIR overrides it so the sweep can run against a private,
    // out-of-repo set (e.g. real meeting transcripts that must never be committed to this
    // public repo). The override only affects this live theory, not FixtureCorpusTests.
    static string FixturesDirectory =>
        Environment.GetEnvironmentVariable("EVAL_FIXTURES_DIR") is { Length: > 0 } dir
            ? dir
            : Path.Combine(AppContext.BaseDirectory, "Fixtures");

    // Live progress counters. Parallelization is disabled (AssemblyInfo), so the sweep is
    // serial; the counter is still Interlocked for cleanliness. TotalCases is the matrix
    // size, computed once on first use. Progress is written to stderr because xUnit v2
    // doesn't capture Console, so it streams live during `dotnet test` (unlike
    // ITestOutputHelper, which only surfaces under detailed verbosity).
    static readonly Lazy<int> TotalCases = new(() => Matrix.Count());
    static int _caseNumber;

    // VSTest buffers a test's Console output and only flushes it when the test finishes,
    // so the per-row lines below are invisible during the long live sweep. When
    // EVAL_PROGRESS_FILE is set (make eval sets it), also append each line to that plain
    // file so it can be `tail -F`'d live. Best-effort: a logging failure never sinks a case.
    static readonly string? ProgressFile = Environment.GetEnvironmentVariable("EVAL_PROGRESS_FILE");

    static void Progress(string line)
    {
        Console.Error.WriteLine(line);
        var file = ProgressFile;
        if (string.IsNullOrEmpty(file)) return;
        try
        {
            var dir = Path.GetDirectoryName(file);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            File.AppendAllText(file, line + Environment.NewLine);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    readonly ITestOutputHelper _output;

    public BedrockEvalTheory(ITestOutputHelper output) => _output = output;

    public static IEnumerable<object[]> Matrix =>
        from fixture in FixtureLoader.LoadAll(FixturesDirectory)
        from prompt in Prompts
        from model in Models
        select new object[] { fixture, prompt, model };

    [SkippableTheory]
    [MemberData(nameof(Matrix))]
    public async Task Score(Fixture fixture, AnalysisPrompt prompt, string modelId)
    {
        Skip.IfNot(EvalRunner.IsEnabled, $"{EvalRunner.EnvFlag} not set — skipping live Bedrock eval.");

        // Pace the sweep on rate-limited accounts: a small delay between cases lets the
        // Bedrock per-minute limit recover, so Standard retry doesn't have to absorb the
        // whole burst. Opt-in via EVAL_REQUEST_DELAY_MS (make eval sets a default).
        if (int.TryParse(Environment.GetEnvironmentVariable("EVAL_REQUEST_DELAY_MS"), out var delayMs) && delayMs > 0)
            await Task.Delay(delayMs);

        var caseNo = Interlocked.Increment(ref _caseNumber);
        var total = TotalCases.Value;
        Progress($"[eval {caseNo}/{total}] running {modelId} x {fixture.Id} ...");

        var bedrock = BedrockEvalFactory.AnalysisService(prompt, modelId);
        var judge = BedrockEvalFactory.Judge();
        var qualityJudge = BedrockEvalFactory.QualityJudge();

        EvalRow row;
        try
        {
            row = await EvalRunner.RunAsync(
                fixture, prompt, modelId, bedrock, judge, qualityJudge, RunId, ResultsDirectory);
        }
        catch (Exception ex) when (ex is AmazonServiceException or AmazonClientException)
        {
            // Sweeping "all accessible models" means some won't be: not access-granted
            // (AccessDenied), invalid/unknown id (ValidationException), or inference-
            // profile-only — all AmazonServiceException. Retry exhaustion under heavy
            // throttling ("capacity could not be obtained") is instead a plain
            // AmazonClientException. In AWS SDK for .NET v4 these are SEPARATE branches
            // (not parent/child), so we must catch BOTH — otherwise an invalid or
            // inaccessible model hard-fails the case instead of skipping. Skipping lets
            // one bad model drop out of the sweep without sinking the rest.
            // The judge model is named too: if it's the inaccessible one, EVERY case
            // skips, and the shared judge id in the message is the tell (rather than
            // looking like the system-under-test model was at fault).
            var judgeModelId = BedrockEvalFactory.JudgeModelId;
            Progress(
                $"[eval {caseNo}/{total}] SKIP {modelId} x {fixture.Id}: {ex.GetType().Name} ({total - caseNo} remaining)");
            _output.WriteLine(
                $"SKIP {modelId} on {fixture.Id} (judge: {judgeModelId}): {ex.GetType().Name} — {ex.Message}");
            Skip.If(true, $"{modelId} (or judge {judgeModelId}) unavailable: {ex.Message}");
            return;
        }

        Progress(
            $"[eval {caseNo}/{total}] done {modelId} x {fixture.Id}  " +
            $"QUALITY={row.Quality:F2} (tags={row.QualityTags:F2} act={row.QualityActions:F2} dec={row.QualityDecisions:F2} content={row.QualityContent:F2}) ({total - caseNo} remaining)");
        _output.WriteLine(
            $"{row.FixtureId} [{row.ModelId} / {row.PromptVersion}]  " +
            $"tagF1={row.TagF1:F2} actionF1={row.ActionF1:F2} content={row.ContentScore:F2}");
    }

    // Renders the accumulated results into a markdown table. Run after the matrix:
    //   dotnet test --filter Category=Report
    [SkippableFact]
    [Trait("Category", "Report")]
    public void GenerateReport()
    {
        Skip.IfNot(Directory.Exists(ResultsDirectory), "No Results directory — run the eval matrix first.");

        var markdown = Report.Render(ResultsDirectory);
        var path = Path.Combine(ResultsDirectory, "report.md");
        File.WriteAllText(path, markdown);

        _output.WriteLine(markdown);
        _output.WriteLine($"Report written to {path}");
    }
}
