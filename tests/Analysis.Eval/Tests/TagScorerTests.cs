using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

public class TagScorerTests
{
    [Fact]
    public void Case_insensitive_and_order_independent_perfect_match()
    {
        var result = TagScorer.Score(
            expected: ["auth", "Backend"],
            predicted: ["backend", "AUTH"]);

        Assert.Equal(1.0, result.Precision);
        Assert.Equal(1.0, result.Recall);
        Assert.Equal(1.0, result.F1);
    }

    [Fact]
    public void Missing_tag_drops_recall_to_half()
    {
        var result = TagScorer.Score(
            expected: ["auth", "backend"],
            predicted: ["auth"]);

        Assert.Equal(1.0, result.Precision);
        Assert.Equal(0.5, result.Recall);
    }

    [Fact]
    public void Extra_tag_drops_precision_to_half()
    {
        var result = TagScorer.Score(
            expected: ["auth"],
            predicted: ["auth", "backend"]);

        Assert.Equal(0.5, result.Precision);
        Assert.Equal(1.0, result.Recall);
    }

    [Fact]
    public void Empty_predicted_is_zero_precision_and_zero_recall()
    {
        var result = TagScorer.Score(
            expected: ["auth"],
            predicted: []);

        Assert.Equal(0.0, result.Recall);
        Assert.Equal(0.0, result.F1);
    }

    [Fact]
    public void Empty_expected_and_empty_predicted_is_perfect()
    {
        var result = TagScorer.Score(expected: [], predicted: []);

        Assert.Equal(1.0, result.F1);
    }
}
