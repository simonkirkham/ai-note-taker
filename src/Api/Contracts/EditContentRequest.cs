namespace Api.Contracts;

// BUG-47: ExpectedBaseContentHash is the SHA-256 (lower-hex) of the content the client loaded before
// editing. Optional — when present the handler enforces the content optimistic-concurrency guard;
// when absent the guard is skipped (unchanged behaviour for non-browser callers).
public record EditContentRequest(string Content, string? ExpectedBaseContentHash = null);
