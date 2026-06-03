namespace Api.Services;

public sealed record AnalysisPrompt(string Version, Func<NoteAnalysisRequest, string> Build);

public static class PromptCatalog
{
    public static readonly AnalysisPrompt V1 = new("analysis@v1", BuildV1);

    public static AnalysisPrompt Current => V1;

    static string BuildV1(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        var contentInstruction = request.AllowContentRewrite
            ? "- Fill gaps in the note content using the information available. Do not repeat what is already there."
            : "- Do NOT change the note content. Return the existing note content unchanged in \"updatedContent\".";

        return $$"""
        You are a meeting notes assistant. Analyse the note below and update it.

        CURRENT NOTE CONTENT:
        {{request.ExistingContent}}

        {{transcriptSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        {{contentInstruction}}
        - Infer relevant tags (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - Extract action items assigned to "{{request.CurrentUserName}}" only. Other people's actions should appear in updatedContent, not in newActionItems.
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {
          "updatedContent": "<full updated note content as plain text>",
          "newTags": ["tag1", "tag2"],
          "newActionItems": ["Action item text"]
        }
        """;
    }
}
