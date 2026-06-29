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

        var converseRequest = new ConverseRequest
        {
            ModelId = _modelId,
            Messages =
            [
                new Message
                {
                    Role = ConversationRole.User,
                    Content = [new ContentBlock { Text = prompt }]
                }
            ],
            InferenceConfig = new InferenceConfiguration { MaxTokens = 2048 }
        };

        var response = await _bedrock.ConverseAsync(converseRequest, ct).ConfigureAwait(false);
        var modelText = ConverseResponseReader.Text(response);

        if (!AnalysisResponseParser.TryParse(modelText, _modelId, _prompt.Version, out var result))
            _logger.LogWarning("Failed to parse Bedrock response (AnalysisParseFallback); returning an empty summary, leaving the user's note untouched. Model {ModelId} prompt {PromptVersion}, {TextLength} chars of model text", _modelId, _prompt.Version, modelText.Length);
        else if (string.IsNullOrWhiteSpace(result.Summary) && result.DiscussionPoints.Count == 0 && result.Decisions.Count == 0)
            _logger.LogWarning("Bedrock analysis produced an empty summary (AnalysisSummaryEmpty) for model {ModelId} prompt {PromptVersion}", _modelId, _prompt.Version);
        else
            _logger.LogInformation("Bedrock analysis produced a summary: {SummaryLength} chars, {DiscussionCount} discussion points, {DecisionCount} decisions", result.Summary.Length, result.DiscussionPoints.Count, result.Decisions.Count);

        return result;
    }
}
