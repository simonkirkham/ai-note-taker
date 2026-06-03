namespace Domain.Notes;

public record RecordAnalysisSummary(
    NoteId NoteId,
    string Summary,
    IReadOnlyList<string> DiscussionPoints,
    IReadOnlyList<string> Decisions,
    string ModelId,
    string PromptVersion) : NoteCommand;
