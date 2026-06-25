using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

public class JudgeVerdictParseTests
{
    [Fact]
    public void Parses_yes_no_array_from_model_text()
    {
        var verdicts = BedrockContentJudgeClient.ParseVerdicts("[\"YES\", \"NO\"]", 2);

        Assert.Equal([true, false], verdicts);
    }

    [Fact]
    public void Tolerates_surrounding_prose_and_is_case_insensitive()
    {
        var verdicts = BedrockContentJudgeClient.ParseVerdicts("Here are the verdicts: [\"yes\",\"Yes\",\"no\"]", 3);

        Assert.Equal([true, true, false], verdicts);
    }

    [Fact]
    public void Pads_missing_verdicts_with_false_to_the_expected_count()
    {
        var verdicts = BedrockContentJudgeClient.ParseVerdicts("[\"YES\"]", 3);

        Assert.Equal([true, false, false], verdicts);
    }

    [Fact]
    public void Trims_extra_verdicts_to_the_expected_count()
    {
        var verdicts = BedrockContentJudgeClient.ParseVerdicts("[\"YES\",\"YES\",\"YES\"]", 2);

        Assert.Equal([true, true], verdicts);
    }
}
