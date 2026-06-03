using Amazon.BedrockRuntime.Model;

namespace Api.Services;

// Pulls the model's text output from a Bedrock Converse response. Shared by the
// analysis service and the eval judge so the envelope-unwrap lives in one place.
public static class ConverseResponseReader
{
    public static string Text(ConverseResponse response) =>
        response?.Output?.Message?.Content is { Count: > 0 } content
            ? content[0].Text ?? ""
            : "";
}
