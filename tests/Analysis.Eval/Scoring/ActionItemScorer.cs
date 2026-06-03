namespace Analysis.Eval.Scoring;

public static class ActionItemScorer
{
    public static ScoreReport Score(IReadOnlyList<string> expected, IReadOnlyList<string> predicted)
    {
        throw new NotImplementedException(
            "Pip: lowercased + punctuation-stripped exact match; compute P/R/F1.");
    }
}
