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
    readonly string _modelId;

    public BedrockAnalysisService(IAmazonBedrockRuntime bedrock, ILogger<BedrockAnalysisService> logger)
    {
        _bedrock = bedrock;
        _logger = logger;
        _modelId = Environment.GetEnvironmentVariable("BEDROCK_MODEL_ID") ?? "";
    }

    public async Task<NoteAnalysisResult> AnalyseAsync(
        string transcriptText, string existingContent, string currentUserName, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_modelId))
            throw new InvalidOperationException("BEDROCK_MODEL_ID is not configured.");

        var prompt = BuildPrompt(transcriptText, existingContent, currentUserName);

        var body = JsonSerializer.Serialize(new
        {
            anthropic_version = "bedrock-2023-05-31",
            max_tokens = 2048,
            messages = new[] { new { role = "user", content = prompt } }
        });

        var request = new InvokeModelRequest
        {
            ModelId = _modelId,
            ContentType = "application/json",
            Accept = "application/json",
            Body = new MemoryStream(Encoding.UTF8.GetBytes(body))
        };

        var response = await _bedrock.InvokeModelAsync(request, ct).ConfigureAwait(false);
        var responseBody = await new StreamReader(response.Body).ReadToEndAsync(ct).ConfigureAwait(false);

        return ParseResponse(responseBody, existingContent);
    }

    NoteAnalysisResult ParseResponse(string responseBody, string existingContent)
    {
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            var text = doc.RootElement
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

            var updatedContent = root.GetProperty("updatedContent").GetString() ?? existingContent;
            var newTags = root.GetProperty("newTags").EnumerateArray()
                .Select(t => t.GetString() ?? "")
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .ToList();
            var newActionItems = root.GetProperty("newActionItems").EnumerateArray()
                .Select(a => a.GetString() ?? "")
                .Where(a => !string.IsNullOrWhiteSpace(a))
                .ToList();

            return new NoteAnalysisResult(updatedContent, newTags, newActionItems);
        }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            _logger.LogWarning(ex, "Failed to parse Bedrock response; returning original content unchanged");
            return new NoteAnalysisResult(existingContent, [], []);
        }
    }

    static string BuildPrompt(string transcriptText, string existingContent, string currentUserName) => $$"""
        You are a meeting notes assistant. Analyse the transcript below and update the meeting note.

        CURRENT NOTE CONTENT:
        {{existingContent}}

        TRANSCRIPT:
        {{transcriptText}}

        CURRENT USER: {{currentUserName}}

        Instructions:
        - Fill gaps in the note content using information from the transcript. Do not repeat what is already there.
        - Infer relevant tags (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - Extract action items assigned to "{{currentUserName}}" only. Other people's actions should appear in updatedContent, not in newActionItems.
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {
          "updatedContent": "<full updated note content as plain text>",
          "newTags": ["tag1", "tag2"],
          "newActionItems": ["Action item text"]
        }
        """;
}
