namespace Analysis.Eval.Scoring;

public interface IJudgeClient
{
    Task<IReadOnlyList<bool>> RateAsync(string content, IReadOnlyList<string> facts, CancellationToken ct = default);
}

public sealed class ContentJudge
{
    readonly IJudgeClient _judge;

    public ContentJudge(IJudgeClient judge) => _judge = judge;

    public async Task<double> ScoreAsync(string content, IReadOnlyList<string> requiredFacts, CancellationToken ct = default)
    {
        if (requiredFacts.Count == 0)
            return 1.0;

        var verdicts = await _judge.RateAsync(content, requiredFacts, ct);
        if (verdicts.Count == 0)
            return 1.0;

        return verdicts.Count(present => present) / (double)verdicts.Count;
    }
}
