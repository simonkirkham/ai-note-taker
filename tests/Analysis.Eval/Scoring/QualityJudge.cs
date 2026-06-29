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
    string Rationale);

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
    IReadOnlyList<string> GroundedEntities);

public interface IQualityJudge
{
    Task<QualityScore> ScoreAsync(QualityJudgeInput input, CancellationToken ct = default);
}
