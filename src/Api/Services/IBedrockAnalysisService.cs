namespace Api.Services;

public interface IBedrockAnalysisService
{
    Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default);
}

public record NoteAnalysisRequest(
    string ExistingContent,
    string? TranscriptText,
    string CurrentUserName,
    bool AllowContentRewrite
);

public record NoteAnalysisResult(
    string UpdatedContent,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems
);
