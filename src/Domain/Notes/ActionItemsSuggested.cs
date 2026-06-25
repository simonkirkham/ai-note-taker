namespace Domain.Notes;

// Value equality must compare the ActionItemIds collection element-wise; the compiler-generated
// record equality compares the list by reference, which would break spec assertions.
public sealed record ActionItemsSuggested(NoteId NoteId, IReadOnlyList<Guid> ActionItemIds) : NoteEvent
{
    public bool Equals(ActionItemsSuggested? other) =>
        other is not null && NoteId.Equals(other.NoteId) && ActionItemIds.SequenceEqual(other.ActionItemIds);

    public override int GetHashCode() =>
        ActionItemIds.Aggregate(NoteId.GetHashCode(), HashCode.Combine);
}
