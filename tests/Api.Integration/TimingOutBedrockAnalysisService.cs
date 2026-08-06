using Api.Services;

namespace Api.Integration;

// BUG-58: stands in for a Bedrock inference that outlived the client-side deadline. The real
// BedrockAnalysisService raises TimeoutException itself once its deadline fires.
public sealed class TimingOutBedrockAnalysisService : IBedrockAnalysisService
{
    public Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default) =>
        throw new TimeoutException("Bedrock analysis did not complete within 20s (BEDROCK_ANALYSIS_TIMEOUT).");
}
