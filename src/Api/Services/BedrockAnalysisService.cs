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

    public async Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_modelId))
            throw new InvalidOperationException("BEDROCK_MODEL_ID is not configured.");

        var prompt = BuildPrompt(request);

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

        return ParseResponse(responseBody, request.ExistingContent);
    }

    NoteAnalysisResult ParseResponse(string responseBody, string existingContent)
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

    static string BuildPrompt(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        var contentInstruction = request.AllowContentRewrite
            ? "- Fill gaps in the note content using the information available. Do not repeat what is already there."
            : "- Do NOT change the note content. Return the existing note content unchanged in \"updatedContent\".";

        return $$"""
        You are a meeting notes assistant. Analyse the note below and update it.

        CURRENT NOTE CONTENT:
        {{request.ExistingContent}}

        {{transcriptSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        {{contentInstruction}}
        - Infer relevant tags (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - Extract action items assigned to "{{request.CurrentUserName}}" only. Other people's actions should appear in updatedContent, not in newActionItems.
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {
          "updatedContent": "<full updated note content as plain text>",
          "newTags": ["tag1", "tag2"],
          "newActionItems": ["Action item text"]
        }
        """;
    }
}
