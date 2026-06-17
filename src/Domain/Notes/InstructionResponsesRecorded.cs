namespace Domain.Notes;

// Value equality must compare the Responses collection element-wise; the compiler-generated
// record equality compares lists by reference, which would break spec assertions.
public sealed record InstructionResponsesRecorded(
    NoteId NoteId,
    IReadOnlyList<InstructionResponse> Responses,
    string ModelId,
    string PromptVersion) : NoteEvent
{
    public bool Equals(InstructionResponsesRecorded? other) =>
        other is not null
        && NoteId.Equals(other.NoteId)
        && Responses.SequenceEqual(other.Responses)
        && ModelId == other.ModelId
        && PromptVersion == other.PromptVersion;

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(NoteId);
        foreach (var response in Responses) hash.Add(response);
        hash.Add(ModelId);
        hash.Add(PromptVersion);
        return hash.ToHashCode();
    }
}
