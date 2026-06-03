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
        var prompt = $$"""
            You are a strict, consistent evaluator of AI-generated meeting notes, scoring against
            the preferences of the user the note is for ({{x.CurrentUserName}}). Score the GENERATED
            NOTE against the TRANSCRIPT (the ground truth) using the rubric below. Apply it identically
            every time; be harsh — vague, sparse, or over-confident notes are low quality.

            TRANSCRIPT:
            {{x.Transcript}}

            EXISTING NOTE ({{x.CurrentUserName}} wrote this already; may be empty):
            {{x.ExistingContent}}

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

            Score each dimension 0.0–1.0:
            - tags: a SMALL, MINIMAL set (ideally ~2-4) of recurring, findable entities/themes so
              {{x.CurrentUserName}} can retrieve related notes later — people & companies (proper nouns),
              work streams/projects, and the recurring meeting type. Reward restraint and light tagging;
              PENALISE long, noisy, or over-tagged lists. Fewer high-signal tags beats many.
            - actions: contains ONLY {{x.CurrentUserName}}'s own commitments (other people's actions must
              NOT appear here) and is accurate (no invented or wrong actions).
            - decisions: only actual decisions reached (not topics merely discussed), accurate, complete
              (no key decision missed), and clearly and specifically stated.
            - content: summary + discussion cover what matters with breadth (don't miss real points),
              are faithful (light inference OK, no invented facts), flag uncertainty rather than guessing,
              and are well-organised (tight wording, bullet points, headers grouping related content).
            - overall: your holistic 0.0–1.0 usefulness of this note to {{x.CurrentUserName}}, weighting
              the preferences above.

            Return ONLY JSON, no other text:
            {"tags":0.0,"actions":0.0,"decisions":0.0,"content":0.0,"overall":0.0,"rationale":"one short sentence"}
            """;

        var response = await _bedrock.ConverseAsync(new ConverseRequest
        {
            ModelId = _modelId,
            Messages = [new Message { Role = ConversationRole.User, Content = [new ContentBlock { Text = prompt }] }],
            InferenceConfig = new InferenceConfiguration { MaxTokens = 400 }
        }, ct).ConfigureAwait(false);

        return Parse(ConverseResponseReader.Text(response));
    }

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
            Rationale: r.TryGetProperty("rationale", out var ra) && ra.ValueKind == JsonValueKind.String ? ra.GetString() ?? "" : "");
    }

    static double ReadScore(JsonElement root, string name) =>
        root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? Math.Clamp(v.GetDouble(), 0.0, 1.0)
            : 0.0;

    static string Bullets(IReadOnlyList<string> items) =>
        items.Count == 0 ? "(none)" : string.Join("\n", items.Select(i => $"- {i}"));
}
