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

    // MPI-10: Style is averaged only over rows that carry a style score (the real corpus). A
    // group whose rows have null qualityStyle must render "—", never a fabricated 0.000 that
    // would dilute a real average — that's the whole reason Style is nullable.
    [Fact]
    public void Style_column_averages_only_gold_note_rows_and_shows_dash_when_none()
    {
        var jsonl = string.Join("\n",
            // Group A: both rows carry a style score → the column shows their mean (0.400).
            """{"runId":"r1","fixtureId":"real-a","modelId":"nova-lite","promptVersion":"analysis@v8","tagF1":0.5,"actionF1":0.5,"contentScore":0.5,"qualityStyle":0.2}""",
            """{"runId":"r1","fixtureId":"real-b","modelId":"nova-lite","promptVersion":"analysis@v8","tagF1":0.5,"actionF1":0.5,"contentScore":0.5,"qualityStyle":0.6}""",
            // Group B: no style scores (synthetic corpus) → the Style cell must be "—".
            """{"runId":"r1","fixtureId":"syn-1","modelId":"nova-pro","promptVersion":"analysis@v8","tagF1":0.5,"actionF1":0.5,"contentScore":0.5}""");
        File.WriteAllText(Path.Combine(_resultsDir, "r1.jsonl"), jsonl);

        var report = Report.Render(_resultsDir);
        var lines = report.Split('\n');

        var groupA = Assert.Single(lines, l => l.Contains("nova-lite"));
        Assert.Contains("0.400", groupA);
        // Style must be the em-dash placeholder, not a fabricated 0.000, for the no-gold group.
        var groupB = Assert.Single(lines, l => l.Contains("nova-pro"));
        Assert.Contains("—", groupB);
    }
}
