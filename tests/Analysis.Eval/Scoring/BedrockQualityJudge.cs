using System.Text;
using System.Text.Json;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Api.Services;

namespace Analysis.Eval.Scoring;

// Rubric-based holistic judge. The rubric encodes the user's stated preferences (captured
// via interview) so the score reflects THEIR definition of a good note, applied identically
// to every model by a neutral judge model (default Claude, to avoid Nova-judging-Nova bias).
public sealed class BedrockQualityJudge : IQualityJudge
{
    readonly IAmazonBedrockRuntime _bedrock;
    readonly string _modelId;

    public BedrockQualityJudge(IAmazonBedrockRuntime bedrock, string modelId)
    {
        _bedrock = bedrock;
        _modelId = modelId;
    }

    public async Task<QualityScore> ScoreAsync(QualityJudgeInput x, CancellationToken ct = default)
    {
        var prompt = BuildPrompt(x);

        var response = await _bedrock.ConverseAsync(new ConverseRequest
        {
            ModelId = _modelId,
            Messages = [new Message { Role = ConversationRole.User, Content = [new ContentBlock { Text = prompt }] }],
            InferenceConfig = new InferenceConfiguration { MaxTokens = 400 }
        }, ct).ConfigureAwait(false);

        return Parse(ConverseResponseReader.Text(response));
    }

    // Built separately so the grounding + terseness rubric wording can be unit-tested
    // without a live Bedrock call (see BedrockQualityJudgePromptTests).
    internal static string BuildPrompt(QualityJudgeInput x) =>
        $$"""
            You are a strict, consistent evaluator of AI-generated meeting notes, scoring against
            the preferences of the user the note is for ({{x.CurrentUserName}}). Score the GENERATED
            NOTE against the SOURCE using the rubric below. Apply it identically
            every time; be harsh — vague, over-confident, or padded notes are low quality.

            The SOURCE is BOTH the transcript AND the user's existing note below. BOTH are ground
            truth: any name, number, company, person, or fact that appears in EITHER is grounded and
            must NOT be treated as invented or unfaithful. Only content absent from both is ungrounded.

            TRANSCRIPT:
            {{x.Transcript}}

            EXISTING NOTE ({{x.CurrentUserName}} wrote this already; may be empty — it is valid grounding, not fabrication):
            {{x.ExistingContent}}
            {{Allowlist(x.GroundedEntities)}}
            GENERATED NOTE
            Summary: {{x.Summary}}
            Discussion:
            {{Bullets(x.Discussion)}}
            Decisions:
            {{Bullets(x.Decisions)}}
            Tags: {{string.Join(", ", x.Tags)}}
            Action items (should be {{x.CurrentUserName}}'s own only):
            {{Bullets(x.Actions)}}

            {{x.CurrentUserName}}'s preferences — REWARD these, PENALISE their opposites:
            - BREADTH over brevity: when a point is borderline relevant, including it is BETTER than
              dropping it. Do NOT penalise thoroughness; DO penalise missing real content. Completeness
              beats conciseness — "concise" means tight wording and no filler, never fewer real points.
            - LIGHT INFERENCE is welcome: surfacing an implied decision or connecting obvious dots is
              good and is NOT unfaithfulness. But penalise heavy editorialising or facts not grounded
              in the transcript.
            - FLAG UNCERTAINTY: when something is ambiguous (unclear owner, a fuzzy "maybe"), the note
              should flag it as uncertain. REWARD hedging on ambiguous items; PENALISE confidently
              stating an ambiguous thing as fact — a confident wrong claim is worse than a flagged one.

            Score each dimension 0.0–1.0. Use the FULL range and be decisive — do NOT cluster around
            0.5: a clearly weak dimension scores below 0.3, an excellent one above 0.8.

            - tags: a SMALL, MINIMAL set — ideally 2-3, NEVER more than ~5 — of recurring, findable
              entities/themes so {{x.CurrentUserName}} can retrieve related notes later (people &
              companies, work streams/projects, recurring meeting type). Score HARSHLY: more than ~5
              tags, or any generic/low-signal tag, is over-tagging and scores ≤ 0.4. Fewer high-signal
              tags is strongly better than many.
            - actions: contains ONLY {{x.CurrentUserName}}'s own commitments (other people's actions must
              NOT appear here — their presence is a serious error) and is accurate (no invented/wrong actions).
            - decisions: only actual decisions reached (not topics merely discussed), accurate, complete
              (no key decision missed), and clearly and specifically stated.
            - content: summary + discussion should capture the substance and detail the SOURCE
              supports. Judge thinness RELATIVE TO THE SOURCE. When the transcript is rich, a light,
              shallow, or headline-only note that drops real content is a MAJOR failure (≤ 0.4) even
              when faithful. But when the transcript is genuinely thin or sparse, a short faithful note
              is the CORRECT output — do NOT auto-fail it for length: a terse note that captures
              everything the sparse source contains scores HIGH. Never reward padding or invented
              detail added to look thorough. Reward depth where the source supports it; require the note
              to be faithful (light inference OK, no facts absent from the source), to flag uncertainty
              rather than guess, and to be well-organised (tight wording, bullets, headers).
            {{StyleRubric(x)}}- overall: your holistic 0.0–1.0 usefulness of this note to {{x.CurrentUserName}}, weighting
              the preferences above.

            Return ONLY JSON, no other text:
            {{ReturnJsonSpec(x)}}
            """;

    static bool HasGold(QualityJudgeInput x) => !string.IsNullOrWhiteSpace(x.GoldNote);

    // MPI-10: the style dimension only exists when the fixture carries the user's own note as a
    // gold exemplar. Rendered inline so the gold note sits next to the rubric that references it.
    // Omitted entirely (empty string) on the synthetic corpus, where no style score is returned.
    static string StyleRubric(QualityJudgeInput x) =>
        !HasGold(x)
            ? ""
            : $$"""
                USER'S OWN NOTE for this meeting ({{x.CurrentUserName}} wrote it — this is the STYLE GOLD,
                the target voice and shape; it is grounding, never fabrication):
                {{x.GoldNote}}

                - style: how closely the GENERATED NOTE matches the STYLE of {{x.CurrentUserName}}'s OWN NOTE
                  above — NOT whether it reproduces the same words. REWARD: subject-first factual bullets (a
                  person, a system, or a number leads — NEVER "The team discussed…", "The meeting…", "There is
                  a need to"); maximum fact coverage in minimum words with NO filler ("longer but terser");
                  structure via short headers + nested bullets; named attribution where the transcript supports
                  it; the user's own spelling of names/companies/acronyms. PENALISE: neutral third-party
                  minutes prose, "The team discussed X" openers, padding, and losing the dense factual voice.
                  Do NOT penalise the generated note for omitting the user's private judgement, opinions, or
                  questions that are absent from the transcript — those are the user's to add; score STYLE and
                  transcript-grounded fact coverage, not reproduction of personal interpretation.

                """;

    static string ReturnJsonSpec(QualityJudgeInput x) =>
        HasGold(x)
            ? """{"tags":0.0,"actions":0.0,"decisions":0.0,"content":0.0,"style":0.0,"overall":0.0,"rationale":"one short sentence"}"""
            : """{"tags":0.0,"actions":0.0,"decisions":0.0,"content":0.0,"overall":0.0,"rationale":"one short sentence"}""";

    static QualityScore Parse(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end < start)
            throw new JsonException($"No JSON object in quality-judge response: {text}");

        using var doc = JsonDocument.Parse(text[start..(end + 1)]);
        var r = doc.RootElement;
        return new QualityScore(
            Overall: ReadScore(r, "overall"),
            Tags: ReadScore(r, "tags"),
            Actions: ReadScore(r, "actions"),
            Decisions: ReadScore(r, "decisions"),
            Content: ReadScore(r, "content"),
            Rationale: r.TryGetProperty("rationale", out var ra) && ra.ValueKind == JsonValueKind.String ? ra.GetString() ?? "" : "",
            // MPI-10: null when the judge returned no `style` (no gold note in the fixture), so the
            // report averages it only over real-corpus fixtures rather than diluting with a 0.0.
            Style: r.TryGetProperty("style", out var st) && st.ValueKind == JsonValueKind.Number
                ? Math.Clamp(st.GetDouble(), 0.0, 1.0)
                : null);
    }

    static double ReadScore(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? Math.Clamp(v.GetDouble(), 0.0, 1.0)
            : 0.0;

    static string Bullets(IReadOnlyList<string> items) =>
        items.Count == 0 ? "(none)" : string.Join("\n", items.Select(i => $"- {i}"));

    // MPI-5: deterministic grounding. These entities are grounded by construction (the
    // fixture's gold tags), so the judge must never count them as fabrication — closing the
    // note-blindness that prompt wording alone (MPI-4) left open. Omitted entirely when empty.
    static string Allowlist(IReadOnlyList<string> groundedEntities) =>
        groundedEntities.Count == 0
            ? ""
            : $"""

                GROUNDED ENTITIES — each of these appears in the SOURCE and is CONFIRMED grounded.
                NEVER treat any of them (or a close variant) as invented, fabricated, or unfaithful:
                {string.Join("\n", groundedEntities.Select(e => $"- {e}"))}
                """;
}
