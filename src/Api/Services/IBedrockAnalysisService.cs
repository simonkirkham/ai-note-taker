namespace Api.Services;

public interface IBedrockAnalysisService
{
    Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default);
}

public record NoteAnalysisRequest(
    string ExistingContent,
    string? TranscriptText,
    string CurrentUserName
);

public record NoteAnalysisResult(
    string Summary,
    IReadOnlyList<string> DiscussionPoints,
    IReadOnlyList<string> Decisions,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems,
    string ModelId = "",
    string PromptVersion = ""
);
