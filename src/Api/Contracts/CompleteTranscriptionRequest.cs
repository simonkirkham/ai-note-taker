namespace Api.Contracts;

public record CompleteTranscriptionRequest(string TranscriptText, int DurationSeconds);
