using System.Text.Json.Serialization;

namespace TranscribeCompletion;

// The EventBridge "Transcribe Job State Change" event (source aws.transcribe). Only the detail
// fields we act on are modelled; the rest of the envelope is ignored by the deserializer.
public sealed class TranscribeJobStateChange
{
    [JsonPropertyName("detail")]
    public TranscribeJobDetail Detail { get; set; } = new();
}

public sealed class TranscribeJobDetail
{
    [JsonPropertyName("TranscriptionJobName")]
    public string TranscriptionJobName { get; set; } = "";

    [JsonPropertyName("TranscriptionJobStatus")]
    public string TranscriptionJobStatus { get; set; } = "";
}
