using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

public class ContentJudgeTests
{
    [Fact]
    public async Task Score_is_yes_count_over_total()
    {
        var judge = new StubJudge([true, false]);
        var sut = new ContentJudge(judge);

        var score = await sut.ScoreAsync(
            content: "Bob agreed to update the docs by Tuesday.",
            requiredFacts: ["Bob will update the docs", "Alice has no action items"]);

        Assert.Equal(0.5, score);
    }

    [Fact]
    public async Task All_facts_present_scores_one()
    {
        var judge = new StubJudge([true, true]);
        var sut = new ContentJudge(judge);

        var score = await sut.ScoreAsync("...", ["a", "b"]);

        Assert.Equal(1.0, score);
    }

    [Fact]
    public async Task No_facts_required_scores_one_by_convention()
    {
        var judge = new StubJudge([]);
        var sut = new ContentJudge(judge);

        var score = await sut.ScoreAsync("anything", []);

        Assert.Equal(1.0, score);
    }

    sealed class StubJudge(IReadOnlyList<bool> verdicts) : IJudgeClient
    {
        public Task<IReadOnlyList<bool>> RateAsync(
            string content, IReadOnlyList<string> facts, CancellationToken ct = default)
            => Task.FromResult(verdicts);
    }
}
