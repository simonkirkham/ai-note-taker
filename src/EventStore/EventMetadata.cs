namespace EventStore;

public record EventMetadata(
    Guid CommandId,
    string? UserId,
    string? CorrelationId,
    string? CausationId,
    // Phase 23-B: the workspace the write happened in. Nullable + defaulted so every
    // existing 4-arg construction still compiles and old event JSON (no WorkspaceId
    // field) deserialises to null — read paths resolve null to the default workspace.
    string? WorkspaceId = null);
