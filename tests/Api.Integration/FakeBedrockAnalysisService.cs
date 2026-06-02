using Api.Services;

namespace Api.Integration;

public sealed class FakeBedrockAnalysisService : IBedrockAnalysisService
{
    public NoteAnalysisResult NextResult { get; set; } = new("", [], []);
    public NoteAnalysisRequest? LastRequest { get; private set; }

    public Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default)
    {
        LastRequest = request;
        return Task.FromResult(NextResult);
    }
}
