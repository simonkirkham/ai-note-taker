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
    IReadOnlyList<string> Actions);

public interface IQualityJudge
{
    Task<QualityScore> ScoreAsync(QualityJudgeInput input, CancellationToken ct = default);
}
