namespace EventStore.Projections;

public record ActionItemFeedbackView(string UserId, int SuggestedCount, int DeletedCount, int CompletedCount);

public record ActionItemFeedbackProvenance(string ActionItemId, string UserId);
