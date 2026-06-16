using Domain.Notes;

namespace EventStore.Projections;

public record NoteDetailView(
    NoteId NoteId,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset LastModifiedAt,
    DateOnly? Date = null,
    IReadOnlyList<string>? Tags = null,
    string UserId = "",
    string? TranscriptText = null,
    string? Summary = null,
    IReadOnlyList<string>? DiscussionPoints = null,
    IReadOnlyList<string>? Decisions = null,
    string? SummaryModelId = null,
    string? SummaryPromptVersion = null,
    string? WorkspaceId = null,
    IReadOnlyList<InstructionResponse>? InstructionResponses = null);
