namespace EventStore.Projections;

public record TagFeedbackView(string UserId, string Tag, int SuggestedCount, int RejectedCount)
{
    public int AcceptedCount => SuggestedCount - RejectedCount;
}

public record TagFeedbackProvenance(string NoteId, string Tag, string UserId);
