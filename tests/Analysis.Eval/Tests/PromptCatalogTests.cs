using Api.Services;

namespace Analysis.Eval.Tests;

public class PromptCatalogTests
{
    [Fact]
    public void Current_is_v1_by_default()
    {
        Assert.Equal("analysis@v1", PromptCatalog.Current.Version);
    }

    [Fact]
    public void V1_build_substitutes_user_transcript_and_content()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice",
            AllowContentRewrite: true);

        var prompt = PromptCatalog.V1.Build(request);

        Assert.Contains("a transcript", prompt);
        Assert.Contains("existing notes", prompt);
        Assert.Contains("Alice", prompt);
    }
}
