namespace EventStore;

public record EventMetadata(
    Guid CommandId,
    string? UserId,
    string? CorrelationId,
    string? CausationId,
    // Phase 23-B: the workspace the write happened in. Nullable + defaulted so every
    // existing 4-arg construction still compiles and old event JSON (no WorkspaceId
    // field) deserialises to null — read paths resolve null to the default workspace.
    string? WorkspaceId = null,
    // 33-B2: the writer's display name at write time. Stamped by the HTTP command path so the note's
    // owner name survives to the async re-analysis (the TranscribeCompletion Lambda has no
    // ICurrentUser; the Bedrock prompt needs the name to attribute action items). Nullable +
    // defaulted: existing constructions and old event JSON deserialise to null.
    string? UserName = null);
