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
    IReadOnlyList<InstructionResponse>? InstructionResponses = null,
    string? RecordingAudioKey = null,
    bool TranscriptIsDiarized = false,
    // 33-B2: the owner's display name, folded from the NoteCreated event metadata. Lets the async
    // re-analysis (TranscribeCompletion Lambda, no ICurrentUser) pass the name to the Bedrock prompt.
    string OwnerName = "",
    // 43-A: the meeting agenda — topics to discuss, in capture order. Folded from AgendaItemAdded;
    // stored separately from the free-form Content (the clean break from "a topic = a heading").
    IReadOnlyList<AgendaItemView>? Agenda = null);
