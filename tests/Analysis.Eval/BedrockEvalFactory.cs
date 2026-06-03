using Amazon;
using Amazon.BedrockRuntime;
using Amazon.Runtime;
using Analysis.Eval.Scoring;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Analysis.Eval;

// Builds the live, Bedrock-backed objects for the eval matrix. Only invoked from
// RUN_BEDROCK_EVAL-gated tests, so the AmazonBedrockRuntimeClient (which resolves
// ambient AWS creds + region) is never constructed in PR CI.
public static class BedrockEvalFactory
{
    static readonly Lazy<IAmazonBedrockRuntime> Runtime = new(BuildClient);

    static IAmazonBedrockRuntime BuildClient()
    {
        // A full sweep fires many InvokeModel calls in a burst — every fixture × model,
        // plus a judge call per fixture, and the judge is one shared model — which trips
        // Bedrock throttling (429). Adaptive retry adds client-side rate-limiting and
        // exponential backoff so throttled calls wait and succeed instead of being
        // skipped, keeping the fixture set even across models (otherwise the busiest
        // model — the judge — silently loses fixtures and its scores aren't comparable).
        var config = new AmazonBedrockRuntimeConfig
        {
            RetryMode = RequestRetryMode.Adaptive,
            MaxErrorRetry = 10,
        };
        // Passing a config bypasses the parameterless ctor's region auto-resolution, so
        // carry the region across explicitly (env first, then the SDK fallback chain).
        var region = Environment.GetEnvironmentVariable("AWS_REGION")
                     ?? Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION");
        config.RegionEndpoint = !string.IsNullOrEmpty(region)
            ? RegionEndpoint.GetBySystemName(region)
            : FallbackRegionFactory.GetRegionEndpoint();
        return new AmazonBedrockRuntimeClient(config);
    }

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
