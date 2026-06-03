namespace Analysis.Eval.Tests;

public class ReportTests : IDisposable
{
    readonly string _resultsDir;

    public ReportTests()
    {
        _resultsDir = Path.Combine(Path.GetTempPath(), "analysis-eval-report-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_resultsDir);
    }

    public void Dispose()
    {
        if (Directory.Exists(_resultsDir)) Directory.Delete(_resultsDir, recursive: true);
    }

    [Fact]
    public void Aggregates_rows_into_markdown_table_grouped_by_prompt_and_model()
    {
        var jsonl = string.Join("\n",
            """{"runId":"r1","fixtureId":"f1","modelId":"nova-lite","promptVersion":"analysis@v1","tagF1":0.8,"actionF1":0.6,"contentScore":0.9}""",
            """{"runId":"r1","fixtureId":"f2","modelId":"nova-lite","promptVersion":"analysis@v1","tagF1":0.6,"actionF1":0.8,"contentScore":0.7}""",
            """{"runId":"r1","fixtureId":"f1","modelId":"nova-pro","promptVersion":"analysis@v1","tagF1":0.9,"actionF1":0.9,"contentScore":0.95}""");
        File.WriteAllText(Path.Combine(_resultsDir, "r1.jsonl"), jsonl);

        var report = Report.Render(_resultsDir);

        Assert.Contains("analysis@v1", report);
        Assert.Contains("nova-lite", report);
        Assert.Contains("nova-pro", report);
        Assert.Contains("|", report);
    }

    [Fact]
    public void Empty_results_directory_produces_an_empty_table_header()
    {
        var report = Report.Render(_resultsDir);

        Assert.Contains("Prompt", report);
        Assert.Contains("Model", report);
    }
}
