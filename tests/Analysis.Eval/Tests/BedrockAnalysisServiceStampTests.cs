namespace Analysis.Eval.Tests;

public class BedrockAnalysisServiceStampTests
{
    [SkippableFact]
    public void NoteAnalysisResult_carries_ModelId_and_PromptVersion()
    {
        Skip.If(true, "Pip: enable once NoteAnalysisResult is widened to carry ModelId + PromptVersion " +
                      "and BedrockAnalysisService is constructed with (AnalysisPrompt, modelId). " +
                      "Assertion: given AnalyseAsync returns, ModelId == 'amazon.nova-lite-v1:0' and PromptVersion == 'analysis@v1'.");
    }
}
