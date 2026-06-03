using System.Text;
using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Microsoft.Extensions.Logging;

namespace Api.Services;

public sealed class BedrockAnalysisService : IBedrockAnalysisService
{
    readonly IAmazonBedrockRuntime _bedrock;
    readonly ILogger<BedrockAnalysisService> _logger;
    readonly AnalysisPrompt _prompt;
    readonly string _modelId;

    public BedrockAnalysisService(
        IAmazonBedrockRuntime bedrock,
        ILogger<BedrockAnalysisService> logger,
        AnalysisPrompt prompt,
        string modelId)
    {
        _bedrock = bedrock;
        _logger = logger;
        _prompt = prompt;
        _modelId = modelId;
    }

    public async Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_modelId))
            throw new InvalidOperationException("BEDROCK_MODEL_ID is not configured.");

        var prompt = _prompt.Build(request);

        var body = JsonSerializer.Serialize(new
        {
            schemaVersion = "messages-v1",
            messages = new[] { new { role = "user", content = new[] { new { text = prompt } } } },
            inferenceConfig = new { maxTokens = 2048 }
        });

        var invokeRequest = new InvokeModelRequest
        {
            ModelId = _modelId,
            ContentType = "application/json",
            Accept = "application/json",
            Body = new MemoryStream(Encoding.UTF8.GetBytes(body))
        };

        var response = await _bedrock.InvokeModelAsync(invokeRequest, ct).ConfigureAwait(false);
        var responseBody = await new StreamReader(response.Body).ReadToEndAsync(ct).ConfigureAwait(false);

        return ParseResponse(responseBody);
    }

    NoteAnalysisResult ParseResponse(string responseBody)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            var text = doc.RootElement
                .GetProperty("output")
                .GetProperty("message")
                .GetProperty("content")[0]
                .GetProperty("text")
                .GetString() ?? "";

            var startIndex = text.IndexOf('{');
            var endIndex = text.LastIndexOf('}');
            if (startIndex < 0 || endIndex < 0)
                throw new JsonException("No JSON object found in response");

            var json = text[startIndex..(endIndex + 1)];
            using var result = JsonDocument.Parse(json);
            var root = result.RootElement;

            var summary = ReadString(root, "summary");
            var discussionPoints = ReadStringArray(root, "discussion");
            var decisions = ReadStringArray(root, "decisions");
            var newTags = ReadStringArray(root, "newTags");
            var newActionItems = ReadStringArray(root, "newActionItems");

            if (string.IsNullOrWhiteSpace(summary) && discussionPoints.Count == 0 && decisions.Count == 0)
                _logger.LogWarning("Bedrock analysis produced an empty summary (AnalysisSummaryEmpty) for model {ModelId} prompt {PromptVersion}", _modelId, _prompt.Version);
            else
                _logger.LogInformation("Bedrock analysis produced a summary: {SummaryLength} chars, {DiscussionCount} discussion points, {DecisionCount} decisions", summary.Length, discussionPoints.Count, decisions.Count);

            return new NoteAnalysisResult(summary, discussionPoints, decisions, newTags, newActionItems, _modelId, _prompt.Version);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Failed to parse Bedrock response (AnalysisSummaryEmpty); returning an empty summary, leaving the user's note untouched");
            return new NoteAnalysisResult("", [], [], [], [], _modelId, _prompt.Version);
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
