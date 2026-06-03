using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Analysis.Eval;

public static class Report
{
    static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static string Render(string resultsDirectory)
    {
        var rows = Directory.Exists(resultsDirectory)
            ? Directory.EnumerateFiles(resultsDirectory, "*.jsonl")
                .SelectMany(File.ReadLines)
                .Where(line => !string.IsNullOrWhiteSpace(line))
                .Select(line => JsonSerializer.Deserialize<EvalRow>(line, JsonOptions)!)
                .ToList()
            : [];

        var sb = new StringBuilder();
        sb.AppendLine("| Prompt | Model | Quality | Tags | Actions | Decisions | Content | Faithfulness | Fixtures |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");

        // Headline is the rubric-based Quality; rows ordered best-first so the table reads
        // as a ranking. The atomic scores (TagF1/ActionF1/ContentScore) stay in the jsonl.
        var groups = rows
            .GroupBy(r => (r.PromptVersion, r.ModelId))
            .OrderByDescending(g => g.Average(r => r.Quality))
            .ThenBy(g => g.Key.PromptVersion, StringComparer.Ordinal);

        foreach (var group in groups)
        {
            sb.AppendLine(string.Join(" ",
                "|", group.Key.PromptVersion,
                "|", group.Key.ModelId,
                "|", Mean(group.Select(r => r.Quality)),
                "|", Mean(group.Select(r => r.QualityTags)),
                "|", Mean(group.Select(r => r.QualityActions)),
                "|", Mean(group.Select(r => r.QualityDecisions)),
                "|", Mean(group.Select(r => r.QualityContent)),
                "|", Mean(group.Select(r => r.FaithfulnessScore)),
                "|", group.Count().ToString(CultureInfo.InvariantCulture),
                "|"));
        }

        return sb.ToString();
    }

    static string Mean(IEnumerable<double> values)
    {
        var list = values.ToList();
        return list.Count == 0
            ? "—"
            : list.Average().ToString("F3", CultureInfo.InvariantCulture);
    }
}
