using Api.Services;

namespace Analysis.Eval.Tests;

public class PromptCatalogTests
{
    [Fact]
    public void Current_is_v6()
    {
        Assert.Equal("analysis@v6", PromptCatalog.Current.Version);
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

    [Fact]
    public void V4_build_pushes_for_grounded_depth()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V4.Build(request);

        Assert.Contains("a transcript", prompt);
        Assert.Contains("existing notes", prompt);
        Assert.Contains("Alice", prompt);
        Assert.Contains("\"summary\"", prompt);
        Assert.Contains("\"discussion\"", prompt);
        Assert.Contains("\"decisions\"", prompt);
        Assert.DoesNotContain("updatedContent", prompt);
        Assert.Contains("DO NOT edit", prompt);
        Assert.Contains("SHALLOW", prompt);
        Assert.Contains("DEEP", prompt);
        Assert.Contains("Do NOT invent", prompt);
    }

    [Fact]
    public void V5_keeps_depth_but_clamps_grounding_first_and_restores_tag_discipline()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V5.Build(request);

        Assert.Contains("a transcript", prompt);
        Assert.Contains("existing notes", prompt);
        Assert.Contains("Alice", prompt);
        Assert.Contains("\"summary\"", prompt);
        Assert.Contains("\"discussion\"", prompt);
        Assert.Contains("\"decisions\"", prompt);
        Assert.DoesNotContain("updatedContent", prompt);
        Assert.Contains("DO NOT edit", prompt);
        Assert.Contains("SHALLOW", prompt);
        Assert.Contains("DEEP", prompt);
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("THIN TRANSCRIPT", prompt);
        Assert.Contains("recurring themes", prompt);
    }

    [Fact]
    public void V6_tightens_the_tag_rule_while_keeping_v5_grounding_and_depth()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V6.Build(request);

        // V5's grounding + depth wording is preserved verbatim.
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("THIN TRANSCRIPT", prompt);
        Assert.Contains("SHALLOW", prompt);
        Assert.Contains("DEEP", prompt);

        // The tightened tag rule: explicit small-set target + retrieval rationale.
        Assert.Contains("aim for 2–3 tags", prompt);
        Assert.Contains("NEVER more than 5", prompt);
        Assert.Contains("Fewer strong tags is much better", prompt);

        Assert.Equal("analysis@v6", PromptCatalog.V6.Version);
    }
}
