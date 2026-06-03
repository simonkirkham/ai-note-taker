namespace Analysis.Eval;

public static class Report
{
    public static string Render(string resultsDirectory)
    {
        throw new NotImplementedException(
            "Pip: read all *.jsonl under resultsDirectory, group rows by (PromptVersion, ModelId), compute mean Tag F1 / Action F1 / Content score per group, render as a markdown table.");
    }
}
