using System.Text.Json;

namespace Api.Services;

// Maps the model's text output to a NoteAnalysisResult. The model is told to return
// JSON; we extract the first {...} object and read the known fields. Transport-agnostic
// and pure, so it's unit-testable without a Bedrock client. On any parse failure it
// returns an empty result, leaving the user's note untouched.
public static class AnalysisResponseParser
{
    public static NoteAnalysisResult Parse(string modelText, string modelId, string promptVersion)
    {
        try
        {
            var startIndex = modelText.IndexOf('{');
            var endIndex = modelText.LastIndexOf('}');
            if (startIndex < 0 || endIndex < 0)
                throw new JsonException("No JSON object found in response");

            var json = modelText[startIndex..(endIndex + 1)];
            using var result = JsonDocument.Parse(json);
            var root = result.RootElement;

            return new NoteAnalysisResult(
                ReadString(root, "summary"),
                ReadStringArray(root, "discussion"),
                ReadStringArray(root, "decisions"),
                ReadStringArray(root, "newTags"),
                ReadStringArray(root, "newActionItems"),
                modelId,
                promptVersion);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return new NoteAnalysisResult("", [], [], [], [], modelId, promptVersion);
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
