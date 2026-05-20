using Api.Services;

namespace Api.Integration;

public sealed class FakeBedrockAnalysisService : IBedrockAnalysisService
{
    public NoteAnalysisResult NextResult { get; set; } = new("", [], []);

    public Task<NoteAnalysisResult> AnalyseAsync(
        string transcriptText, string existingContent, string currentUserName, CancellationToken ct = default)
        => Task.FromResult(NextResult);
}
