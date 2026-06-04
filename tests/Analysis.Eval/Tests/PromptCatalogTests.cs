using Api.Services;

namespace Analysis.Eval.Tests;

public class PromptCatalogTests
{
    [Fact]
    public void Current_is_v3()
    {
        Assert.Equal("analysis@v3", PromptCatalog.Current.Version);
    }

    [Fact]
    public void V1_build_substitutes_user_transcript_and_content()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V1.Build(request);

        Assert.Contains("a transcript", prompt);
        Assert.Contains("existing notes", prompt);
        Assert.Contains("Alice", prompt);
    }

    [Fact]
    public void V2_build_asks_for_structured_output_and_forbids_editing_the_note()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V2.Build(request);

        Assert.Contains("a transcript", prompt);
        Assert.Contains("existing notes", prompt);
        Assert.Contains("Alice", prompt);
        Assert.Contains("\"summary\"", prompt);
        Assert.Contains("\"discussion\"", prompt);
        Assert.Contains("\"decisions\"", prompt);
        Assert.DoesNotContain("updatedContent", prompt);
        Assert.Contains("DO NOT edit", prompt);
    }
}
