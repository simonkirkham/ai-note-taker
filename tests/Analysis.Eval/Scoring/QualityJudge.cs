namespace Analysis.Eval.Scoring;

// Rubric-based holistic quality score. The rubric encodes the user's definition of a good
// note (see BedrockQualityJudge for the criteria), applied identically to every model by a
// neutral judge — so it scales across models/prompts without per-run human review.
public sealed record QualityScore(
    double Overall,
    double Tags,
    double Actions,
    double Decisions,
    double Content,
    string Rationale,
    // MPI-10: how closely the generated note matches the user's OWN note style — dense
    // subject-first facts, headers/bullets, named attribution, the user's spelling, no filler
    // ("longer but terser"). Null when the fixture carries no gold note (the synthetic corpus),
    // so the report averages it only over the real-corpus fixtures that have a style gold.
    double? Style = null);

public sealed record QualityJudgeInput(
    string Transcript,
    string ExistingContent,
    string CurrentUserName,
    string Summary,
    IReadOnlyList<string> Discussion,
    IReadOnlyList<string> Decisions,
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> Actions,
    // MPI-5: entities grounded by definition (the fixture's curated gold tags). Rendered into
    // the prompt as a deterministic "never call these fabrication" allowlist, because prompt
    // wording alone (MPI-4) did not stop the judge mis-flagging note/gold entities like
    // "Stark Industries" as invented (run-28225, 14-all-hands-reorg content 0.20).
    IReadOnlyList<string> GroundedEntities,
    // MPI-10: the user's own note, verbatim — the STYLE exemplar. When non-empty the prompt
    // gains a `style` dimension scoring how closely the generated note matches it. Empty/null
    // on the synthetic corpus, where the block is omitted and no style score is returned.
    string? GoldNote = null);

public interface IQualityJudge
{
    Task<QualityScore> ScoreAsync(QualityJudgeInput input, CancellationToken ct = default);
}
