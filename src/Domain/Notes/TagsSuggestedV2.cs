namespace Domain.Notes;

// v2 of TagsSuggested (10-M): adds ModelId/PromptVersion so a captured correction can be tied
// to the exact prompt/model that produced the suggestion. Provenance only; no aggregate state change.
// Value equality must compare the Tags collection element-wise; the compiler-generated record
// equality compares the list by reference, which would break spec assertions.
public sealed record TagsSuggestedV2(NoteId NoteId, IReadOnlyList<string> Tags, string ModelId, string PromptVersion) : NoteEvent
{
    public bool Equals(TagsSuggestedV2? other) =>
        other is not null && NoteId.Equals(other.NoteId) && Tags.SequenceEqual(other.Tags)
        && ModelId == other.ModelId && PromptVersion == other.PromptVersion;

    public override int GetHashCode() =>
        Tags.Aggregate(HashCode.Combine(NoteId, ModelId, PromptVersion), HashCode.Combine);
}
