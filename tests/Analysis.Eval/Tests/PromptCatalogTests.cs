using Api.Services;

namespace Analysis.Eval.Tests;

public class PromptCatalogTests
{
    [Fact]
    public void Current_is_v9()
    {
        Assert.Equal("analysis@v9", PromptCatalog.Current.Version);
    }

    [Fact]
    public void V9_adds_the_style_rewrite_and_keeps_v8_grounding_tags_and_instruction_path()
    {
        var plain = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V9.Build(plain);

        // The MPI-9 style additions are all present.
        Assert.Contains("LONGER BUT TERSER", prompt);
        Assert.Contains("SUBJECT-FIRST", prompt);
        Assert.Contains("The team discussed", prompt); // the banned-opener example
        Assert.Contains("REACTIONS, NOT JUDGEMENT", prompt);
        Assert.Contains("SPELLING AUTHORITY", prompt);
        Assert.Contains("NEVER output \"Speaker 1\"", prompt);
        Assert.Contains("A decision CLOSES an option", prompt);

        // V8's grounding, thin-transcript clamp, and proper-noun tag rule are carried forward.
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("THIN TRANSCRIPT", prompt);
        Assert.Contains("Emit ONLY proper nouns", prompt);
        Assert.Contains("an empty list is the correct answer", prompt);

        // No new output fields in this slice (openQuestions/notableQuotes are MPI-9b).
        Assert.DoesNotContain("openQuestions", prompt);
        Assert.DoesNotContain("notableQuotes", prompt);
        Assert.DoesNotContain("\"instructionResponses\": [{", prompt);
        Assert.Equal("analysis@v9", PromptCatalog.V9.Version);

        // The inline /ai instruction path is preserved from V8.
        var withInstructions = plain with { Instructions = ["draft a thank-you email"] };
        var instructed = PromptCatalog.V9.Build(withInstructions);
        Assert.Contains("draft a thank-you email", instructed);
        Assert.Contains("\"instructionResponses\"", instructed);
        Assert.Contains("SUBJECT-FIRST", instructed);
        Assert.Contains("UNCHANGED by the instructions", instructed);
    }

    [Fact]
    public void V8_narrows_tags_to_proper_nouns_and_keeps_v7_instruction_path()
    {
        var plain = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V8.Build(plain);

        // The proper-noun-only tag rule replaces V6/V7's "aim for 2–3 tags / meeting type" wording.
        Assert.Contains("Emit ONLY proper nouns", prompt);
        Assert.Contains("ALWAYS tag the primary entity the meeting is about", prompt);
        Assert.Contains("an empty list is the correct answer", prompt);
        Assert.DoesNotContain("aim for 2–3 tags", prompt);
        Assert.DoesNotContain("the meeting type (e.g. \"1:1\", \"standup\")", prompt);
        // V8 keeps V7's grounding + depth and stays the shipping prompt.
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("THIN TRANSCRIPT", prompt);
        Assert.DoesNotContain("\"instructionResponses\": [{", prompt);
        Assert.Equal("analysis@v8", PromptCatalog.V8.Version);

        // The inline /ai instruction path is preserved from V7.
        var withInstructions = plain with { Instructions = ["draft a thank-you email"] };
        var instructed = PromptCatalog.V8.Build(withInstructions);
        Assert.Contains("draft a thank-you email", instructed);
        Assert.Contains("\"instructionResponses\"", instructed);
        Assert.Contains("Emit ONLY proper nouns", instructed);
        Assert.Contains("UNCHANGED by the instructions", instructed);
    }

    [Fact]
    public void V7_without_instructions_keeps_v6_grounding_and_omits_instruction_responses()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice");

        var prompt = PromptCatalog.V7.Build(request);

        // V6's grounding + depth + tag wording is preserved.
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("THIN TRANSCRIPT", prompt);
        Assert.Contains("aim for 2–3 tags", prompt);
        // With no instructions, the output JSON schema must not include the instructionResponses field.
        Assert.DoesNotContain("\"instructionResponses\": [{", prompt);
        Assert.Equal("analysis@v7", PromptCatalog.V7.Version);
    }

    [Fact]
    public void V7_with_instructions_asks_to_execute_each_and_return_responses()
    {
        var request = new NoteAnalysisRequest(
            ExistingContent: "existing notes",
            TranscriptText: "a transcript",
            CurrentUserName: "Alice",
            Instructions: ["add an agenda for the weekend", "draft a thank-you email"]);

        var prompt = PromptCatalog.V7.Build(request);

        // Both instructions are surfaced to the model and the output schema includes responses.
        Assert.Contains("add an agenda for the weekend", prompt);
        Assert.Contains("draft a thank-you email", prompt);
        Assert.Contains("\"instructionResponses\"", prompt);
        // Grounding for the summary is explicitly held even while instructions may generate.
        Assert.Contains("GROUNDING COMES FIRST", prompt);
        Assert.Contains("UNCHANGED by the instructions", prompt);
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
