namespace Api.Contracts;

// Health is observability only (TI-99): it never reaches the domain command or the event, and older
// installed desktop builds send none — so it is optional and defaults to null.
public record CompleteTranscriptionRequest(string TranscriptText, int DurationSeconds, TranscriptHealth? Health = null);

// How the live transcription stream was doing when the client saved. Every field is untrusted
// client input — TranscriptHealthReporter whitelists and clamps before anything is logged.
public record TranscriptHealth(
    string? Engine = null,
    string? EndReason = null,
    string? ErrorName = null,
    string? ErrorMessage = null,
    double? CoveredSeconds = null,
    double? SecondsSinceLastText = null,
    double? AudioSecondsSent = null,
    double? SecondsSinceLastAudio = null,
    int? StreamCount = null);
