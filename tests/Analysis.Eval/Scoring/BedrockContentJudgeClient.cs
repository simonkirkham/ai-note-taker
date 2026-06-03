using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Api.Services;

namespace Analysis.Eval.Scoring;

// LLM-as-judge. Deliberately uses a stronger model than the system-under-test
// (default Nova Pro vs the analysed Nova Lite). Atomic rubric: for each fact,
// the judge returns YES/NO whether it is clearly present in the content.
public sealed class BedrockContentJudgeClient : IJudgeClient
{
    readonly IAmazonBedrockRuntime _bedrock;
    readonly string _modelId;

    public BedrockContentJudgeClient(IAmazonBedrockRuntime bedrock, string modelId)
    {
        _bedrock = bedrock;
        _modelId = modelId;
    }

    public async Task<IReadOnlyList<bool>> RateAsync(
        string content, IReadOnlyList<string> facts, CancellationToken ct = default)
    {
        if (facts.Count == 0)
            return [];

        var numberedFacts = string.Join("\n", facts.Select((f, i) => $"{i + 1}. {f}"));
        var prompt = $$"""
            You are grading whether a meeting note contains specific facts.

            NOTE:
            {{content}}

            For each fact below, decide whether it is clearly present in the note.
            Answer YES if present, NO if not.

            FACTS:
            {{numberedFacts}}

            Return ONLY a JSON array of "YES"/"NO" strings, one per fact, in order. No other text.
            """;

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
            InferenceConfig = new InferenceConfiguration { MaxTokens = 512 }
        };

        var response = await _bedrock.ConverseAsync(converseRequest, ct).ConfigureAwait(false);
        return ParseVerdicts(ConverseResponseReader.Text(response), facts.Count);
    }

    internal static IReadOnlyList<bool> ParseVerdicts(string text, int expectedCount)
    {
        var start = text.IndexOf('[');
        var end = text.LastIndexOf(']');
        if (start < 0 || end < 0)
            throw new JsonException($"No JSON array found in judge response: {text}");

        using var array = JsonDocument.Parse(text[start..(end + 1)]);
        var verdicts = array.RootElement.EnumerateArray()
            .Select(v => (v.GetString() ?? "").Trim().StartsWith("YES", StringComparison.OrdinalIgnoreCase))
            .ToList();

        // Defensive: if the judge returned the wrong count, pad/trim to the fact count
        // so scoring stays well-defined rather than throwing mid-matrix.
        while (verdicts.Count < expectedCount) verdicts.Add(false);
        return verdicts.Take(expectedCount).ToList();
    }
}
