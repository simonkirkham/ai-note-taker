namespace Domain.Notes;

public record RecordInstructionResponses(
    NoteId NoteId,
    IReadOnlyList<InstructionResponse> Responses,
    string ModelId,
    string PromptVersion) : NoteCommand;
