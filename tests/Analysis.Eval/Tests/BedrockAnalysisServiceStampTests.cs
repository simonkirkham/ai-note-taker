using Api.Services;

namespace Analysis.Eval.Tests;

public class BedrockAnalysisServiceStampTests
{
    [SkippableFact]
    public async Task NoteAnalysisResult_carries_ModelId_and_PromptVersion()
    {
        Skip.IfNot(EvalRunner.IsEnabled, $"{EvalRunner.EnvFlag} not set — skipping live Bedrock call.");

        const string modelId = "amazon.nova-lite-v1:0";
        var service = BedrockEvalFactory.AnalysisService(PromptCatalog.V2, modelId);

        var result = await service.AnalyseAsync(new NoteAnalysisRequest(
            ExistingContent: "Standup notes",
            TranscriptText: "Alice: I'll fix the login bug by Friday.",
            CurrentUserName: "Alice"));

        Assert.Equal(modelId, result.ModelId);
        Assert.Equal("analysis@v2", result.PromptVersion);
    }
}
