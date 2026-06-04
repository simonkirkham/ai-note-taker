namespace Domain.Notes;

// v2 of ActionItemsSuggested (10-M): adds ModelId/PromptVersion so a captured correction can be tied
// to the exact prompt/model that produced the suggestion. Provenance only; no aggregate state change.
// Value equality must compare the ActionItemIds collection element-wise; the compiler-generated record
// equality compares the list by reference, which would break spec assertions.
public sealed record ActionItemsSuggestedV2(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds, string ModelId, string PromptVersion) : NoteEvent
{
    public bool Equals(ActionItemsSuggestedV2? other) =>
        other is not null && NoteId.Equals(other.NoteId) && ActionItemIds.SequenceEqual(other.ActionItemIds)
        && ModelId == other.ModelId && PromptVersion == other.PromptVersion;

    public override int GetHashCode() =>
        ActionItemIds.Aggregate(HashCode.Combine(NoteId, ModelId, PromptVersion), HashCode.Combine);
}
