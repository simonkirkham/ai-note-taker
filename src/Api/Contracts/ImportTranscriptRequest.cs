namespace Api.Contracts;

// Phase 38: the body of POST /w/{ws}/notes/import-transcript — raw transcript text pasted from an
// external tool. No title/date/attendees in 38-A (plain text only); those are deferred sub-slices.
public record ImportTranscriptRequest(string TranscriptText);
