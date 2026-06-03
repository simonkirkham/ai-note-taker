namespace Domain.Notes;

// Value equality must compare the DiscussionPoints and Decisions collections element-wise;
// the compiler-generated record equality compares lists by reference, which would break spec assertions.
public sealed record AnalysisSummaryRecorded(
    NoteId NoteId,
    string Summary,
    IReadOnlyList<string> DiscussionPoints,
    IReadOnlyList<string> Decisions,
    string ModelId,
    string PromptVersion) : NoteEvent
{
    public bool Equals(AnalysisSummaryRecorded? other) =>
        other is not null
        && NoteId.Equals(other.NoteId)
        && Summary == other.Summary
        && DiscussionPoints.SequenceEqual(other.DiscussionPoints)
        && Decisions.SequenceEqual(other.Decisions)
        && ModelId == other.ModelId
        && PromptVersion == other.PromptVersion;

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(NoteId);
        hash.Add(Summary);
        foreach (var point in DiscussionPoints) hash.Add(point);
        foreach (var decision in Decisions) hash.Add(decision);
        hash.Add(ModelId);
        hash.Add(PromptVersion);
        return hash.ToHashCode();
    }
}
