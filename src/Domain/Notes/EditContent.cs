namespace Domain.Notes;

// BUG-47: ExpectedBaseContentHash is the SHA-256 (lower-hex) of the content the caller loaded before
// editing — an optimistic-concurrency guard on content. When present, the aggregate rejects the edit
// if it no longer matches the current content (the caller edited a stale/empty view and would blank
// real content). null = no guard (legacy/MCP/analysis callers), so their behaviour is unchanged.
public record EditContent(NoteId NoteId, string Content, string? ExpectedBaseContentHash = null) : NoteCommand;
