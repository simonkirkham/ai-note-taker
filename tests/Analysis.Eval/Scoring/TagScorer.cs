namespace Analysis.Eval.Scoring;

public sealed record ScoreReport(double Precision, double Recall, double F1);

public static class TagScorer
{
    public static ScoreReport Score(IReadOnlyList<string> expected, IReadOnlyList<string> predicted)
    {
        throw new NotImplementedException("Pip: case-insensitive set P/R/F1 over normalised tags.");
    }
}
