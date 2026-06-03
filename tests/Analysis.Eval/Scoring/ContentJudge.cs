namespace Analysis.Eval.Scoring;

public interface IJudgeClient
{
    Task<IReadOnlyList<bool>> RateAsync(string content, IReadOnlyList<string> facts, CancellationToken ct = default);
}

public sealed class ContentJudge
{
    readonly IJudgeClient _judge;

    public ContentJudge(IJudgeClient judge) => _judge = judge;

    public Task<double> ScoreAsync(string content, IReadOnlyList<string> requiredFacts, CancellationToken ct = default)
    {
        throw new NotImplementedException(
            "Pip: call _judge.RateAsync(content, requiredFacts) and return yes_count / total.");
    }
}
