using Amazon.Lambda.DynamoDBEvents;

namespace Projector;

// Decides which DynamoDB-stream records the projector should act on, and extracts the
// stream id from each. The events table holds two row kinds written together in one
// TransactWriteItems: event rows (SK = "v{seq:D8}") and the per-stream META row
// (SK = "META#stream"). The stream emits BOTH, so the projector MUST drop META rows —
// it keys only on event rows. REMOVE records have no NewImage (the table is RETAIN, no
// TTL, so these should not occur) and are dropped defensively.
public static class StreamRecordMapper
{
    public static string? TryGetEventStreamId(DynamoDBEvent.DynamodbStreamRecord record)
    {
        var image = record.Dynamodb?.NewImage;
        if (image is null) return null;

        if (!image.TryGetValue("SK", out var sk) || sk.S is null || !sk.S.StartsWith('v'))
            return null;

        return image.TryGetValue("PK", out var pk) ? pk.S : null;
    }
}
