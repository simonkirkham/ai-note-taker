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
        // A full sweep fires many calls in a burst — every fixture × model, plus a judge
        // call per fixture (the judge being one shared model) — which trips Bedrock
        // throttling (429) on a rate-limited account.
        //
        // Use STANDARD retry, not Adaptive. Adaptive's client-side rate limiter gives up
        // under sustained 429s and throws `AmazonClientException: capacity could not be
        // obtained` — which fails the run rather than backing off. Standard mode simply
        // retries with exponential backoff + jitter, which is what let earlier runs
        // complete; a higher MaxErrorRetry just reduces how many fixtures get skipped.
        var config = new AmazonBedrockRuntimeConfig
        {
            RetryMode = RequestRetryMode.Standard,
            MaxErrorRetry = 8,
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
