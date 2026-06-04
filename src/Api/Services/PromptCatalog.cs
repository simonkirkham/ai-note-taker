namespace Api.Services;

public sealed record AnalysisPrompt(string Version, Func<NoteAnalysisRequest, string> Build);

public static class PromptCatalog
{
    public static readonly AnalysisPrompt V1 = new("analysis@v1", BuildV1);

    public static readonly AnalysisPrompt V2 = new("analysis@v2", BuildV2);

    public static readonly AnalysisPrompt V3 = new("analysis@v3", BuildV3);

    public static AnalysisPrompt Current => V3;

    static string BuildV1(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        return $$"""
        You are a meeting notes assistant. Analyse the note below and update it.

        CURRENT NOTE CONTENT:
        {{request.ExistingContent}}

        {{transcriptSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        - Fill gaps in the note content using the information available. Do not repeat what is already there.
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

    static string BuildV2(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        return $$"""
        You are a meeting notes assistant. Read the user's note and the transcript below and produce a structured set of final notes.

        USER'S NOTE (this is the user's own writing — DO NOT edit, rewrite, or reproduce it):
        {{request.ExistingContent}}

        {{transcriptSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        - Do NOT edit or reproduce the user's note. Your output is a separate artifact; the user's note stays untouched.
        - Write a concise "summary" of the meeting (a few sentences of plain text).
        - List the key "discussion" points as short bullet strings.
        - List the "decisions" that were made as short bullet strings.
        - Infer relevant "newTags" (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems.
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {
          "summary": "<concise plain-text summary>",
          "discussion": ["Discussion point"],
          "decisions": ["Decision made"],
          "newTags": ["tag1", "tag2"],
          "newActionItems": ["Action item text"]
        }
        """;
    }

    static string BuildV3(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        return $$"""
        You are a meeting notes assistant. Read the user's note and the transcript below and produce a structured set of final notes.

        USER'S NOTE (this is the user's own writing — DO NOT edit, rewrite, or reproduce it):
        {{request.ExistingContent}}

        {{transcriptSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        - Do NOT edit or reproduce the user's note. Your output is a separate artifact; the user's note stays untouched.
        - Write a concise "summary" of the meeting (a few sentences of plain text).
        - Include all ket facts or assertions. Anything which would be valuable for reference. 
        - Use bullet points and headings to structure the information. For example, you might have sections like "Team Structure", "Company X", "Person's Name", each with their own bullet points.
        - List the key "discussion" points as short bullet strings. 
        - List the "decisions" that were made as short bullet strings.
        - Infer relevant "newTags" (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - There is likely only a fwe tags per conversation. They should be focused on possible recurring themes of work, people, companies, teams, projects, or topics. Avoid generic tags that could apply to any conversation (e.g. "meeting", "sync", "conversation", "notes").
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it. If there is any ambiguity, omit it.
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {
          "summary": "<concise plain-text summary>",
          "discussion": ["Discussion point"],
          "decisions": ["Decision made"],
          "newTags": ["tag1", "tag2"],
          "newActionItems": ["Action item text"]
        }
        """;
    }
}
