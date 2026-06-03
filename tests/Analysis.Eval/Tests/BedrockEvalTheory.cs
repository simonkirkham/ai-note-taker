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

    static readonly AnalysisPrompt[] Prompts = [PromptCatalog.V2];

    static string ResultsDirectory =>
        Path.Combine(AppContext.BaseDirectory, "Results");

    readonly ITestOutputHelper _output;

    public BedrockEvalTheory(ITestOutputHelper output) => _output = output;

    public static IEnumerable<object[]> Matrix =>
        from fixture in FixtureLoader.LoadAll(Path.Combine(AppContext.BaseDirectory, "Fixtures"))
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

        var bedrock = BedrockEvalFactory.AnalysisService(prompt, modelId);
        var judge = BedrockEvalFactory.Judge();

        EvalRow row;
        try
        {
            row = await EvalRunner.RunAsync(
                fixture, prompt, modelId, bedrock, judge, RunId, ResultsDirectory);
        }
        catch (AmazonClientException ex)
        {
            // Sweeping "all accessible models" means some won't be: not access-granted
            // (AccessDenied), not invokable by raw id (needs an inference profile), or
            // not Nova-schema-compatible (ValidationException) — all AmazonServiceException.
            // We also catch the broader AmazonClientException (its base) to cover retry
            // exhaustion under heavy throttling ("capacity could not be obtained"), so a
            // rate-limited tail skips gracefully instead of sinking the whole sweep.
            // The judge model is named too: if it's the inaccessible one, EVERY case
            // skips, and the shared judge id in the message is the tell (rather than
            // looking like the system-under-test model was at fault).
            var judgeModelId = BedrockEvalFactory.JudgeModelId;
            _output.WriteLine(
                $"SKIP {modelId} on {fixture.Id} (judge: {judgeModelId}): {ex.GetType().Name} — {ex.Message}");
            Skip.If(true, $"{modelId} (or judge {judgeModelId}) unavailable: {ex.Message}");
            return;
        }

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
