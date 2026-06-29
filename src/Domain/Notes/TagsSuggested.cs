namespace Domain.Notes;

// Value equality must compare the Tags collection element-wise; the compiler-generated
// record equality compares the list by reference, which would break spec assertions.
public sealed record TagsSuggested(NoteId NoteId, IReadOnlyList<string> Tags) : NoteEvent
{
    public bool Equals(TagsSuggested? other) =>
        other is not null && NoteId.Equals(other.NoteId) && Tags.SequenceEqual(other.Tags);

    public override int GetHashCode() =>
        Tags.Aggregate(NoteId.GetHashCode(), HashCode.Combine);
}
