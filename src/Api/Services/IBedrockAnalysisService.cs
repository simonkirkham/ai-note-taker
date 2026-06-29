using Domain.Notes;

namespace Api.Services;

public interface IBedrockAnalysisService
{
    Task<NoteAnalysisResult> AnalyseAsync(NoteAnalysisRequest request, CancellationToken ct = default);
}

public record NoteAnalysisRequest(
    string ExistingContent,
    string? TranscriptText,
    string CurrentUserName,
    IReadOnlyList<string>? Instructions = null
);

public record NoteAnalysisResult(
    string Summary,
    IReadOnlyList<string> DiscussionPoints,
    IReadOnlyList<string> Decisions,
    IReadOnlyList<string> NewTags,
    IReadOnlyList<string> NewActionItems,
    string ModelId = "",
    string PromptVersion = "",
    IReadOnlyList<InstructionResponse>? InstructionResponses = null
);
