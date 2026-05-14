namespace EventStore;

public record EventMetadata(
    Guid CommandId,
    string? UserId,
    string? CorrelationId,
    string? CausationId);
