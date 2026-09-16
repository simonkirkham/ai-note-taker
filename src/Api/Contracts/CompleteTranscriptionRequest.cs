using System.Text.Json;

namespace Api.Contracts;

// Health is observability only (TI-99): it never reaches the domain command or the event, and older
// installed desktop builds send none — so it is optional and defaults to null. It binds as raw JSON so
// a malformed block can never fail the transcript save; TranscriptHealthReporter parses it field by
// field and reports anything unreadable as malformed.
public record CompleteTranscriptionRequest(string TranscriptText, int DurationSeconds, JsonElement? Health = null);
