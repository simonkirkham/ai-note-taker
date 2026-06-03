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
        sb.AppendLine("| Prompt | Model | Tag F1 | Action F1 | Content | Faithfulness | Fixtures |");
        sb.AppendLine("| --- | --- | --- | --- | --- | --- | --- |");

        var groups = rows
            .GroupBy(r => (r.PromptVersion, r.ModelId))
            .OrderBy(g => g.Key.PromptVersion, StringComparer.Ordinal)
            .ThenBy(g => g.Key.ModelId, StringComparer.Ordinal);

        foreach (var group in groups)
        {
            sb.AppendLine(string.Join(" ",
                "|", group.Key.PromptVersion,
                "|", group.Key.ModelId,
                "|", Mean(group.Select(r => r.TagF1)),
                "|", Mean(group.Select(r => r.ActionF1)),
                "|", Mean(group.Select(r => r.ContentScore)),
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
