using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

public class ActionItemScorerTests
{
    [Fact]
    public void Matches_after_case_and_punctuation_normalisation()
    {
        var result = ActionItemScorer.Score(
            expected: ["Fix the login bug by Friday."],
            predicted: ["fix the login bug by friday"]);

        Assert.Equal(1.0, result.Precision);
        Assert.Equal(1.0, result.Recall);
    }

    [Fact]
    public void Misses_unrelated_paraphrase_in_v1()
    {
        var result = ActionItemScorer.Score(
            expected: ["Fix the login bug by Friday"],
            predicted: ["Resolve authentication issue before weekend"]);

        Assert.Equal(0.0, result.F1);
    }

    [Fact]
    public void No_predicted_items_for_one_expected_item_is_zero_recall()
    {
        var result = ActionItemScorer.Score(
            expected: ["Fix the login bug"],
            predicted: []);

        Assert.Equal(0.0, result.Recall);
    }
}
