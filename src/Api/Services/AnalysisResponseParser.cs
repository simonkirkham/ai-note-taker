using System.Text.Json;

namespace Api.Services;

// Maps the model's text output to a NoteAnalysisResult. The model is told to return
// JSON; we extract the first {...} object and read the known fields. Transport-agnostic
// and pure, so it's unit-testable without a Bedrock client.
//
// Returns false when no well-formed JSON object could be parsed (the "parse-fallback"
// path) so the caller can log that distinctly from a valid-but-empty summary — see the
// AnalysisSummaryEmpty observability contract in docs/phases/phase-15.md. In both the
// fallback and the success case `result` is fully populated (empty on fallback), so the
// caller can always return it and leave the user's note untouched.
public static class AnalysisResponseParser
{
    public static bool TryParse(string modelText, string modelId, string promptVersion, out NoteAnalysisResult result)
    {
        try
        {
            var startIndex = modelText.IndexOf('{');
            var endIndex = modelText.LastIndexOf('}');
            if (startIndex < 0 || endIndex < startIndex)
                throw new JsonException("No JSON object found in response");

            var json = modelText[startIndex..(endIndex + 1)];
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            result = new NoteAnalysisResult(
                ReadString(root, "summary"),
                ReadStringArray(root, "discussion"),
                ReadStringArray(root, "decisions"),
                ReadStringArray(root, "newTags"),
                ReadStringArray(root, "newActionItems"),
                modelId,
                promptVersion);
            return true;
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException)
        {
            result = new NoteAnalysisResult("", [], [], [], [], modelId, promptVersion);
            return false;
        }
    }

    static string ReadString(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : "";

    static List<string> ReadStringArray(JsonElement root, string property) =>
        root.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray()
                .Select(e => e.GetString() ?? "")
                .Where(s => !string.IsNullOrWhiteSpace(s))
                .ToList()
            : [];
}
