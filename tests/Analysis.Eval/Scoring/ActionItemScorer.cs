using System.Text;

namespace Analysis.Eval.Scoring;

public static class ActionItemScorer
{
    public static ScoreReport Score(IReadOnlyList<string> expected, IReadOnlyList<string> predicted)
    {
        var expectedSet = expected.Select(Normalise).Where(s => s.Length > 0).ToHashSet();
        var predictedSet = predicted.Select(Normalise).Where(s => s.Length > 0).ToHashSet();
        var truePositives = expectedSet.Count(predictedSet.Contains);
        return ScoreReport.From(truePositives, expectedSet.Count, predictedSet.Count);
    }

    // v1: lowercase, strip punctuation, collapse whitespace, exact match.
    // Leaves an embedding-cosine hook for v2 once v1 produces false negatives.
    static string Normalise(string item)
    {
        var sb = new StringBuilder(item.Length);
        var lastWasSpace = false;
        foreach (var ch in item.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                sb.Append(ch);
                lastWasSpace = false;
            }
            else if (char.IsWhiteSpace(ch) || char.IsPunctuation(ch) || char.IsSymbol(ch))
            {
                if (!lastWasSpace && sb.Length > 0)
                {
                    sb.Append(' ');
                    lastWasSpace = true;
                }
            }
        }
        return sb.ToString().TrimEnd();
    }
}
