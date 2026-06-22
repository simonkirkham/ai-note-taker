namespace Api.Services;

public sealed record AnalysisPrompt(string Version, Func<NoteAnalysisRequest, string> Build);

public static class PromptCatalog
{
    public static readonly AnalysisPrompt V1 = new("analysis@v1", BuildV1);

    public static readonly AnalysisPrompt V2 = new("analysis@v2", BuildV2);

    public static readonly AnalysisPrompt V3 = new("analysis@v3", BuildV3);

    public static readonly AnalysisPrompt V4 = new("analysis@v4", BuildV4);

    public static readonly AnalysisPrompt V5 = new("analysis@v5", BuildV5);

    public static readonly AnalysisPrompt V6 = new("analysis@v6", BuildV6);

    public static readonly AnalysisPrompt V7 = new("analysis@v7", BuildV7);

    public static readonly AnalysisPrompt V8 = new("analysis@v8", BuildV8);

    public static AnalysisPrompt Current => V8;

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
        - Include all key facts or assertions. Anything which would be valuable for reference. 
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

    static string BuildV4(NoteAnalysisRequest request)
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
        - Capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
          - SHALLOW (do not do this): "Login bug"
          - DEEP (do this): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
        - Include all key facts or assertions. Anything which would be valuable for reference. 
        - Ground every statement in the transcript or the user's note. Do NOT invent names, numbers, companies, dates, or commitments. If something was not actually said, leave it out.
        - When the transcript is short or thin, a short note is the correct answer — do NOT pad it with plausible-sounding but unsupported detail. Depth must come from the source, never from invention.
        - List the key "discussion" points as substantive bullet strings, per the above.
        - List the "decisions" that were made as short bullet strings.
        - Infer relevant "newTags" (short lowercase keywords, e.g. "auth", "backend", "1:1"). There are usually only a few tags per conversation; focus on recurring themes — people, companies, teams, projects, or topics. Avoid generic tags that could apply to any conversation (e.g. "meeting", "sync", "conversation", "notes").
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
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

    static string BuildV5(NoteAnalysisRequest request)
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
        - GROUNDING COMES FIRST, and it OVERRIDES every other instruction below — including the depth instruction. Every name, number, date, company, product, team, and commitment in your output MUST appear in the transcript or the user's note. Never introduce one that was not actually said. If you are unsure whether something was said, leave it out. When grounding and depth conflict, choose grounding: a thinner note is always correct, an invented one never is.
        - When the transcript is short or thin, a SHORT note is the CORRECT answer. Do NOT pad it, do NOT add plausible-sounding detail, and do NOT name people, companies, or figures that were never mentioned.
          - THIN TRANSCRIPT (do this): if the transcript only says the budget was approved, write exactly "Budget approved." — nothing more.
          - THIN TRANSCRIPT (do NOT do this): expanding "the budget was approved" into "the Q3 budget of $2M was approved by the finance team" — none of the figure, the quarter, or the team was in the source.
        - WHERE THE SOURCE SUPPORTS IT, capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
          - SHALLOW (do not do this): "Login bug"
          - DEEP (do this, but ONLY when the transcript actually contains these details): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
        - Include all key facts or assertions that are actually present. Anything which would be valuable for reference.
        - Use bullet points and headings to structure the information where there is enough substance to warrant it.
        - List the key "discussion" points as substantive bullet strings, per the above.
        - List the "decisions" that were made as short bullet strings.
        - Infer relevant "newTags" (short lowercase keywords, e.g. "auth", "backend", "1:1").
        - There is likely only a few tags per conversation. They should be focused on possible recurring themes of work, people, companies, teams, projects, or topics. Avoid generic tags that could apply to any conversation (e.g. "meeting", "sync", "conversation", "notes"). Never create a tag for an entity that was not mentioned in the source.
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
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

    // V6 == V5, with ONLY the tag rule tightened. Tags were the weakest dimension on every
    // model (run-78385: 0.53–0.72 vs 0.85+ elsewhere): the soft "likely only a few tags"
    // wording let models over-tag and emit low-signal tags. V6 makes the target explicit and
    // gives the retrieval rationale, mirroring what the quality judge rewards (a 2–3, ≤5,
    // high-signal set); run-286900 confirmed the win (tags +0.125 mean, no regression) and
    // is why V6 ships. Everything else in V5 (grounding clamp, depth, actions) is unchanged.
    static string BuildV6(NoteAnalysisRequest request)
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
        - GROUNDING COMES FIRST, and it OVERRIDES every other instruction below — including the depth instruction. Every name, number, date, company, product, team, and commitment in your output MUST appear in the transcript or the user's note. Never introduce one that was not actually said. If you are unsure whether something was said, leave it out. When grounding and depth conflict, choose grounding: a thinner note is always correct, an invented one never is.
        - When the transcript is short or thin, a SHORT note is the CORRECT answer. Do NOT pad it, do NOT add plausible-sounding detail, and do NOT name people, companies, or figures that were never mentioned.
          - THIN TRANSCRIPT (do this): if the transcript only says the budget was approved, write exactly "Budget approved." — nothing more.
          - THIN TRANSCRIPT (do NOT do this): expanding "the budget was approved" into "the Q3 budget of $2M was approved by the finance team" — none of the figure, the quarter, or the team was in the source.
        - WHERE THE SOURCE SUPPORTS IT, capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
          - SHALLOW (do not do this): "Login bug"
          - DEEP (do this, but ONLY when the transcript actually contains these details): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
        - Include all key facts or assertions that are actually present. Anything which would be valuable for reference.
        - Use bullet points and headings to structure the information where there is enough substance to warrant it.
        - List the key "discussion" points as substantive bullet strings, per the above.
        - List the "decisions" that were made as short bullet strings.
        - "newTags": tags exist for ONE purpose — so the user can later find OTHER notes on the same person, company, project, or recurring meeting. Optimise for that and nothing else:
          - Pick a SMALL, high-signal set: aim for 2–3 tags, and NEVER more than 5. Fewer strong tags is much better than many weak ones — when in doubt about a tag, leave it out.
          - A good tag is a durable, recurring entity worth retrieving on later: a specific person, company/client, team, project or work-stream, or the meeting type (e.g. "1:1", "standup"). Short lowercase keywords (e.g. "auth", "acme", "hiring").
          - Do NOT emit generic or one-off tags that would never group notes usefully (e.g. "meeting", "sync", "conversation", "notes", "discussion", "update").
          - Never create a tag for an entity that was not mentioned in the source.
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
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

    // V7 adds the ability to execute inline `/ai` instructions the user wrote. The instructions are
    // extracted from the note BEFORE this prompt is built, so the USER'S NOTE the model summarises
    // never contains them. CRITICAL: when there are no instructions, V7 is BYTE-IDENTICAL to V6 —
    // so every existing note and the entire (no-/ai) eval matrix produce the exact V6 prompt, and no
    // summary-quality regression is possible by construction. V7 only diverges when instructions are
    // present. The tension it then encodes: the SUMMARY stays strictly grounded, but an instruction
    // RESPONSE may legitimately generate content the user asked for (an agenda, a drafted email) —
    // while still never presenting invented facts as things said in the meeting.
    static string BuildV7(NoteAnalysisRequest request)
    {
        var instructions = request.Instructions ?? [];
        if (instructions.Count == 0)
            return BuildV6(request);

        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        var instructionsSection = "USER INSTRUCTIONS (the user asked you to carry these out — execute EACH one and return a response):\n"
            + string.Join("\n", instructions.Select((t, i) => $"{i + 1}. {t}"));

        var instructionRules = """
            - INSTRUCTION RESPONSES: carry out every item in USER INSTRUCTIONS above and return them in "instructionResponses" as {"instruction", "response"} pairs, in the same order. The "instruction" echoes the user's request; the "response" is your result.
              - A response MAY generate content the user explicitly asked for (e.g. an agenda, a drafted email, a reworded paragraph) even if that exact text is not in the transcript — that is the point of the instruction.
              - But it must still NOT present invented facts as things that were said: build only on what the note and transcript actually contain. An agenda derived from the topics discussed is good; inventing attendees, dates, or figures that were never mentioned is not.
              - Grounding for "summary", "discussion", "decisions", "newTags", and "newActionItems" is UNCHANGED by the instructions — those remain strictly grounded per the rules above. The instructions only ever add "instructionResponses"; they never loosen the summary.
            """;

        var jsonFormat = """
            {
              "summary": "<concise plain-text summary>",
              "discussion": ["Discussion point"],
              "decisions": ["Decision made"],
              "newTags": ["tag1", "tag2"],
              "newActionItems": ["Action item text"],
              "instructionResponses": [{"instruction": "<the user's instruction>", "response": "<your result>"}]
            }
            """;

        return $$"""
        You are a meeting notes assistant. Read the user's note and the transcript below and produce a structured set of final notes.

        USER'S NOTE (this is the user's own writing — DO NOT edit, rewrite, or reproduce it):
        {{request.ExistingContent}}

        {{transcriptSection}}

        {{instructionsSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        - Do NOT edit or reproduce the user's note. Your output is a separate artifact; the user's note stays untouched.
        - Write a concise "summary" of the meeting (a few sentences of plain text).
        - GROUNDING COMES FIRST, and it OVERRIDES every other instruction below — including the depth instruction. Every name, number, date, company, product, team, and commitment in your output MUST appear in the transcript or the user's note. Never introduce one that was not actually said. If you are unsure whether something was said, leave it out. When grounding and depth conflict, choose grounding: a thinner note is always correct, an invented one never is.
        - When the transcript is short or thin, a SHORT note is the CORRECT answer. Do NOT pad it, do NOT add plausible-sounding detail, and do NOT name people, companies, or figures that were never mentioned.
          - THIN TRANSCRIPT (do this): if the transcript only says the budget was approved, write exactly "Budget approved." — nothing more.
          - THIN TRANSCRIPT (do NOT do this): expanding "the budget was approved" into "the Q3 budget of $2M was approved by the finance team" — none of the figure, the quarter, or the team was in the source.
        - WHERE THE SOURCE SUPPORTS IT, capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
          - SHALLOW (do not do this): "Login bug"
          - DEEP (do this, but ONLY when the transcript actually contains these details): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
        - Include all key facts or assertions that are actually present. Anything which would be valuable for reference.
        - Use bullet points and headings to structure the information where there is enough substance to warrant it.
        - List the key "discussion" points as substantive bullet strings, per the above.
        - List the "decisions" that were made as short bullet strings.
        - "newTags": tags exist for ONE purpose — so the user can later find OTHER notes on the same person, company, project, or recurring meeting. Optimise for that and nothing else:
          - Pick a SMALL, high-signal set: aim for 2–3 tags, and NEVER more than 5. Fewer strong tags is much better than many weak ones — when in doubt about a tag, leave it out.
          - A good tag is a durable, recurring entity worth retrieving on later: a specific person, company/client, team, project or work-stream, or the meeting type (e.g. "1:1", "standup"). Short lowercase keywords (e.g. "auth", "acme", "hiring").
          - Do NOT emit generic or one-off tags that would never group notes usefully (e.g. "meeting", "sync", "conversation", "notes", "discussion", "update").
          - Never create a tag for an entity that was not mentioned in the source.
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
        {{instructionRules}}
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {{jsonFormat}}
        """;
    }

    // V8 == V7 in every dimension EXCEPT the tag rule, which is rewritten to proper-nouns-only.
    // V6/V7 let a tag be a person, company, team, project, OR a meeting type ("1:1", "standup") OR a
    // short topic keyword ("auth", "hiring") — three different kinds of thing. That fuzzy target made
    // tags both noisy (too many kinds qualify) and inconsistent (the named client competed for the
    // 2–3 budget against a meeting-type and sometimes lost, so the same company wasn't tagged on every
    // call). V8 narrows the target to ONE kind: proper nouns (named orgs/clients/vendors, the person a
    // meeting is ABOUT, and named products/projects). The named organisation becomes a MUST-tag so a
    // given client groups across every note, and an empty tag list is explicitly the right answer when
    // no proper noun is named. Like V7, V8 delegates nothing — it carries both the no-instruction and
    // the instruction body so it stays the shipping prompt for Phase 29-A's inline /ai feature.
    static string BuildV8(NoteAnalysisRequest request)
    {
        var transcriptSection = string.IsNullOrWhiteSpace(request.TranscriptText)
            ? "TRANSCRIPT:\n(No transcript was recorded. Analyse the note content above on its own.)"
            : $"TRANSCRIPT:\n{request.TranscriptText}";

        var tagRule = """
            - "newTags": tags exist for ONE purpose — so the user can later find OTHER notes about the same organisation, person, product, or project. Emit ONLY proper nouns and nothing else:
              - ALWAYS tag the primary entity the meeting is about — whichever applies: the named organisation/client/vendor, OR, when no organisation is named, the specific named product, project, incident, or work-stream (e.g. "payments-outage", "q3-launch", "checkout-redesign", "search-relevance"). Every meeting with a named subject gets at least this one tag, every time, so all of its notes group together. This is the most important tag to get right.
              - Also tag any OTHER named organisation/client and the specific person a 1:1 or review is ABOUT (not mere participants or speakers).
              - Do NOT tag meeting types ("1:1", "standup", "qbr", "sync", "retro", "review", "all-hands", "postmortem", "board-meeting") — these are not entities and group nothing useful.
              - Do NOT tag generic topics, themes, or activities ("onboarding", "renewal", "hiring", "growth", "fundraising", "reorg", "observability", "budget", "planning") — tag a topic only when it is a SPECIFIC named product, project, or incident, never a generic activity (tag "payments-outage", the specific incident; do NOT tag "postmortem", the meeting type).
              - Keep it SMALL: most meetings yield 1–3 proper-noun tags, and many yield just one. If a meeting truly names no organisation, person-subject, product, project, or incident, return NO tags — an empty list is the correct answer, never filler.
              - Lowercase each tag and join multi-word names with hyphens (e.g. "Wayne Enterprises" → "wayne-enterprises", "Umbrella Corp" → "umbrella-corp"). Never tag an entity that was not named in the source.
            """;

        if (request.Instructions is not { Count: > 0 } instructions)
        {
            return $$"""
            You are a meeting notes assistant. Read the user's note and the transcript below and produce a structured set of final notes.

            USER'S NOTE (this is the user's own writing — DO NOT edit, rewrite, or reproduce it):
            {{request.ExistingContent}}

            {{transcriptSection}}

            CURRENT USER: {{request.CurrentUserName}}

            Instructions:
            - Do NOT edit or reproduce the user's note. Your output is a separate artifact; the user's note stays untouched.
            - Write a concise "summary" of the meeting (a few sentences of plain text).
            - GROUNDING COMES FIRST, and it OVERRIDES every other instruction below — including the depth instruction. Every name, number, date, company, product, team, and commitment in your output MUST appear in the transcript or the user's note. Never introduce one that was not actually said. If you are unsure whether something was said, leave it out. When grounding and depth conflict, choose grounding: a thinner note is always correct, an invented one never is.
            - When the transcript is short or thin, a SHORT note is the CORRECT answer. Do NOT pad it, do NOT add plausible-sounding detail, and do NOT name people, companies, or figures that were never mentioned.
              - THIN TRANSCRIPT (do this): if the transcript only says the budget was approved, write exactly "Budget approved." — nothing more.
              - THIN TRANSCRIPT (do NOT do this): expanding "the budget was approved" into "the Q3 budget of $2M was approved by the finance team" — none of the figure, the quarter, or the team was in the source.
            - WHERE THE SOURCE SUPPORTS IT, capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
              - SHALLOW (do not do this): "Login bug"
              - DEEP (do this, but ONLY when the transcript actually contains these details): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
            - Include all key facts or assertions that are actually present. Anything which would be valuable for reference.
            - Use bullet points and headings to structure the information where there is enough substance to warrant it.
            - List the key "discussion" points as substantive bullet strings, per the above.
            - List the "decisions" that were made as short bullet strings.
            {{tagRule}}
            - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
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

        var instructionsSection = "USER INSTRUCTIONS (the user asked you to carry these out — execute EACH one and return a response):\n"
            + string.Join("\n", instructions.Select((t, i) => $"{i + 1}. {t}"));

        var instructionRules = """
            - INSTRUCTION RESPONSES: carry out every item in USER INSTRUCTIONS above and return them in "instructionResponses" as {"instruction", "response"} pairs, in the same order. The "instruction" echoes the user's request; the "response" is your result.
              - A response MAY generate content the user explicitly asked for (e.g. an agenda, a drafted email, a reworded paragraph) even if that exact text is not in the transcript — that is the point of the instruction.
              - But it must still NOT present invented facts as things that were said: build only on what the note and transcript actually contain. An agenda derived from the topics discussed is good; inventing attendees, dates, or figures that were never mentioned is not.
              - Grounding for "summary", "discussion", "decisions", "newTags", and "newActionItems" is UNCHANGED by the instructions — those remain strictly grounded per the rules above. The instructions only ever add "instructionResponses"; they never loosen the summary.
            """;

        var jsonFormat = """
            {
              "summary": "<concise plain-text summary>",
              "discussion": ["Discussion point"],
              "decisions": ["Decision made"],
              "newTags": ["tag1", "tag2"],
              "newActionItems": ["Action item text"],
              "instructionResponses": [{"instruction": "<the user's instruction>", "response": "<your result>"}]
            }
            """;

        return $$"""
        You are a meeting notes assistant. Read the user's note and the transcript below and produce a structured set of final notes.

        USER'S NOTE (this is the user's own writing — DO NOT edit, rewrite, or reproduce it):
        {{request.ExistingContent}}

        {{transcriptSection}}

        {{instructionsSection}}

        CURRENT USER: {{request.CurrentUserName}}

        Instructions:
        - Do NOT edit or reproduce the user's note. Your output is a separate artifact; the user's note stays untouched.
        - Write a concise "summary" of the meeting (a few sentences of plain text).
        - GROUNDING COMES FIRST, and it OVERRIDES every other instruction below — including the depth instruction. Every name, number, date, company, product, team, and commitment in your output MUST appear in the transcript or the user's note. Never introduce one that was not actually said. If you are unsure whether something was said, leave it out. When grounding and depth conflict, choose grounding: a thinner note is always correct, an invented one never is.
        - When the transcript is short or thin, a SHORT note is the CORRECT answer. Do NOT pad it, do NOT add plausible-sounding detail, and do NOT name people, companies, or figures that were never mentioned.
          - THIN TRANSCRIPT (do this): if the transcript only says the budget was approved, write exactly "Budget approved." — nothing more.
          - THIN TRANSCRIPT (do NOT do this): expanding "the budget was approved" into "the Q3 budget of $2M was approved by the finance team" — none of the figure, the quarter, or the team was in the source.
        - WHERE THE SOURCE SUPPORTS IT, capture the SUBSTANCE of the discussion, not just topic labels. Each "discussion" bullet should convey what was actually said — the point made plus the reason, number, or context behind it — so the note is useful to someone who did not attend.
          - SHALLOW (do not do this): "Login bug"
          - DEEP (do this, but ONLY when the transcript actually contains these details): "Login bug is blocking the release; Alice traced it to token refresh and will have a fix by Friday."
        - Include all key facts or assertions that are actually present. Anything which would be valuable for reference.
        - Use bullet points and headings to structure the information where there is enough substance to warrant it.
        - List the key "discussion" points as substantive bullet strings, per the above.
        - List the "decisions" that were made as short bullet strings.
        {{tagRule}}
        - Extract "newActionItems" assigned to "{{request.CurrentUserName}}" only. Other people's actions must NOT appear in newActionItems. Be certain an action item is actually assigned to the current user before including it; if there is any ambiguity, omit it.
        {{instructionRules}}
        - Return ONLY valid JSON — no explanation, no markdown fences.

        JSON format:
        {{jsonFormat}}
        """;
    }
}
