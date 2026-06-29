namespace Domain.Notes;

// One inline `/ai` instruction the user wrote and the AI's response to it.
// Value equality on both strings, so lists compare element-wise.
public sealed record InstructionResponse(string Instruction, string Response);
