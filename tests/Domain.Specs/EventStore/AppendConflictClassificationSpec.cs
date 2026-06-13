using Amazon.DynamoDBv2.Model;
using EventStore;

namespace Domain.Specs.EventStore;

// BUG-28: a concurrent same-stream append (e.g. a space-separated multi-tag add fanning into parallel
// POSTs) can be cancelled by DynamoDB with reason "TransactionConflict", NOT "ConditionalCheckFailed".
// Both must be treated as retriable conflicts (→ ConcurrencyException → the command handler re-reads
// and re-appends), or the loser is dropped and surfaces as an unhandled 500. This pins the classifier.
public sealed class AppendConflictClassificationSpec
{
    private static TransactionCanceledException Cancelled(params string[] reasonCodes) =>
        new("transaction cancelled")
        {
            CancellationReasons = reasonCodes.Select(c => new CancellationReason { Code = c }).ToList()
        };

    [Theory]
    [InlineData("ConditionalCheckFailed")]      // our version guard lost
    [InlineData("TransactionConflict")]         // concurrent transaction on the same item (BUG-28)
    [InlineData("None", "TransactionConflict")] // mixed: the conflicting item among non-conflicting ones
    public void Retriable_cancellation_reasons_are_classified_as_conflicts(params string[] reasons)
    {
        Assert.True(DynamoDbEventStore.IsRetriableCancellation(Cancelled(reasons)));
    }

    [Theory]
    [InlineData("ValidationError")]
    [InlineData("ProvisionedThroughputExceeded")]
    [InlineData("None")]
    public void Non_conflict_cancellation_reasons_are_not_retriable(params string[] reasons)
    {
        // A genuine validation/throughput cancellation must NOT masquerade as a concurrency conflict —
        // it would be retried pointlessly and never surface its real cause.
        Assert.False(DynamoDbEventStore.IsRetriableCancellation(Cancelled(reasons)));
    }
}
