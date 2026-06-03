using Amazon.BedrockRuntime;
using Analysis.Eval.Scoring;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Analysis.Eval;

// Builds the live, Bedrock-backed objects for the eval matrix. Only invoked from
// RUN_BEDROCK_EVAL-gated tests, so the AmazonBedrockRuntimeClient (which resolves
// ambient AWS creds + region) is never constructed in PR CI.
public static class BedrockEvalFactory
{
    static readonly Lazy<IAmazonBedrockRuntime> Runtime = new(() => new AmazonBedrockRuntimeClient());

    public static string JudgeModelId =>
        Environment.GetEnvironmentVariable("BEDROCK_JUDGE_MODEL_ID") ?? "amazon.nova-pro-v1:0";

    public static IBedrockAnalysisService AnalysisService(AnalysisPrompt prompt, string modelId) =>
        new BedrockAnalysisService(
            Runtime.Value,
            NullLogger<BedrockAnalysisService>.Instance,
            prompt,
            modelId);

    public static IJudgeClient Judge() =>
        new BedrockContentJudgeClient(Runtime.Value, JudgeModelId);
}
