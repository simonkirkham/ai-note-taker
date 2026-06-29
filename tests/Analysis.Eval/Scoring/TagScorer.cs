namespace Analysis.Eval.Scoring;

public sealed record ScoreReport(double Precision, double Recall, double F1)
{
    public static ScoreReport From(int truePositives, int expectedCount, int predictedCount)
    {
        var precision = predictedCount == 0
            ? (expectedCount == 0 ? 1.0 : 0.0)
            : (double)truePositives / predictedCount;
        var recall = expectedCount == 0
            ? 1.0
            : (double)truePositives / expectedCount;
        var f1 = precision + recall == 0
            ? 0.0
            : 2 * precision * recall / (precision + recall);
        return new ScoreReport(precision, recall, f1);
    }
}

public static class TagScorer
{
    public static ScoreReport Score(IReadOnlyList<string> expected, IReadOnlyList<string> predicted)
    {
        var expectedSet = expected.Select(Normalise).Where(t => t.Length > 0).ToHashSet();
        var predictedSet = predicted.Select(Normalise).Where(t => t.Length > 0).ToHashSet();
        var truePositives = expectedSet.Count(predictedSet.Contains);
        return ScoreReport.From(truePositives, expectedSet.Count, predictedSet.Count);
    }

    static string Normalise(string tag) => tag.Trim().ToLowerInvariant();
}
