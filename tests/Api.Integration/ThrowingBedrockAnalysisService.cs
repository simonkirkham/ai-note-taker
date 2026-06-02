using Amazon.BedrockRuntime;
using Api.Services;

namespace Api.Integration;

public sealed class ThrowingBedrockAnalysisService : IBedrockAnalysisService
{
    public Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default) =>
        throw new AmazonBedrockRuntimeException("Simulated Bedrock failure");
}
