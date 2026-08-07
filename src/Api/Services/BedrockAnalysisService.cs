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
    readonly TimeSpan _timeout;

    // BUG-58: `timeout` is required, not defaulted. A Converse call with no client-side deadline runs
    // until the HOST dies — the Command Lambda's 29s limit killed the process mid-await, so there was
    // no exception, no log line, no metric and no alarm; the user just watched a spinner die at ~29s.
    // The deadline must be shorter than the host's own limit, so only the caller knows the right
    // value — a hidden default would silently mis-size it in the next host that constructs this.
    public BedrockAnalysisService(
        IAmazonBedrockRuntime bedrock,
        ILogger<BedrockAnalysisService> logger,
        AnalysisPrompt prompt,
        string modelId,
        TimeSpan timeout)
    {
        _bedrock = bedrock;
        _logger = logger;
        _prompt = prompt;
        _modelId = modelId;
        _timeout = timeout;
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

        var response = await ConverseWithDeadlineAsync(converseRequest, ct).ConfigureAwait(false);
        var modelText = ConverseResponseReader.Text(response);

        if (!AnalysisResponseParser.TryParse(modelText, _modelId, _prompt.Version, out var result))
            _logger.LogWarning("Failed to parse Bedrock response (AnalysisParseFallback); returning an empty summary, leaving the user's note untouched. Model {ModelId} prompt {PromptVersion}, {TextLength} chars of model text", _modelId, _prompt.Version, modelText.Length);
        else if (string.IsNullOrWhiteSpace(result.Summary) && result.DiscussionPoints.Count == 0 && result.Decisions.Count == 0)
            _logger.LogWarning("Bedrock analysis produced an empty summary (AnalysisSummaryEmpty) for model {ModelId} prompt {PromptVersion}", _modelId, _prompt.Version);
        else
            _logger.LogInformation("Bedrock analysis produced a summary: {SummaryLength} chars, {DiscussionCount} discussion points, {DecisionCount} decisions", result.Summary.Length, result.DiscussionPoints.Count, result.Decisions.Count);

        return result;
    }

    // Bounds the inference so a stalled Bedrock call fails on OUR terms, before the host kills the
    // process. The caller arm comes FIRST so the two-tokens-cancelled case is classified, not
    // dropped: a cancelled caller is not a Bedrock outage, so it must not become a TimeoutException
    // — but it still logs, because BUG-58 is fundamentally about kills that left no trace at all.
    private async Task<ConverseResponse> ConverseWithDeadlineAsync(ConverseRequest request, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(_timeout);
        try
        {
            return await _bedrock.ConverseAsync(request, deadline.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            _logger.LogWarning("Bedrock analysis abandoned — the caller cancelled within its {TimeoutSeconds}s deadline (model {ModelId} prompt {PromptVersion}). Not counted as an analysis failure", _timeout.TotalSeconds, _modelId, _prompt.Version);
            throw;
        }
        // Deliberately catches Exception, not OperationCanceledException: the AWS SDK may wrap a
        // cancellation (AmazonClientException) rather than surfacing a bare OCE, and the test double
        // overrides ConverseAsync so it bypasses the whole SDK pipeline and cannot prove which. If the
        // filter missed, the deadline would throw nothing catchable — the request would 500 past
        // NoteAnalysisService's handler and AnalysisFailures would never increment, i.e. exactly the
        // BUG-58 symptom the deadline exists to remove. Gated on OUR token being the cancelled one, so
        // a genuine Bedrock fault still propagates unchanged.
        catch (Exception ex) when (deadline.IsCancellationRequested && !ct.IsCancellationRequested)
        {
            _logger.LogError(ex, "Bedrock analysis exceeded its {TimeoutSeconds}s deadline for model {ModelId} prompt {PromptVersion}", _timeout.TotalSeconds, _modelId, _prompt.Version);
            throw new TimeoutException(FormattableString.Invariant($"Bedrock analysis did not complete within {_timeout.TotalSeconds}s."), ex);
        }
    }
}
