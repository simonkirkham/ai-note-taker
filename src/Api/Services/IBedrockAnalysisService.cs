namespace Api.Services;

public interface IBedrockAnalysisService
{
    Task<NoteAnalysisResult> AnalyseAsync(string transcriptText, string existingContent, string currentUserName, CancellationToken ct = default);
}

public record NoteAnalysisResult(
    string UpdatedContent,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems
);
