using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

// MPI-4: the quality judge must (a) treat the user's existing note as valid grounding
// alongside the transcript — so gold-tag entities that live in the note aren't flagged
// as fabrication — and (b) not auto-fail a faithful note for being terse when the
// transcript itself is thin. These assert the rubric wording that encodes both fixes.
// MPI-5: prompt wording proved insufficient, so a DETERMINISTIC allowlist of grounded
// entities is rendered into the prompt — see the GroundedEntities tests below.
public class BedrockQualityJudgePromptTests
{
    static QualityJudgeInput Input(
        string transcript = "T",
        string existingContent = "N",
        IReadOnlyList<string>? groundedEntities = null) =>
        new(
            Transcript: transcript,
            ExistingContent: existingContent,
            CurrentUserName: "Sam",
            Summary: "S",
            Discussion: ["d"],
            Decisions: ["dec"],
            Tags: ["t"],
            Actions: ["a"],
            GroundedEntities: groundedEntities ?? []);

    [Fact]
    public void Prompt_names_the_existing_note_as_valid_grounding()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input());

        // The note is explicitly grounding, not fabrication — closes the note-blindness bug.
        Assert.Contains("valid grounding, not fabrication", prompt);
        Assert.Contains("BOTH are ground", prompt);
    }

    [Fact]
    public void Prompt_includes_both_transcript_and_existing_note()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input(transcript: "TRANSCRIPT-BODY", existingContent: "NOTE-BODY"));

        Assert.Contains("TRANSCRIPT-BODY", prompt);
        Assert.Contains("NOTE-BODY", prompt);
    }

    [Fact]
    public void Content_rubric_does_not_auto_fail_a_terse_note_on_a_thin_transcript()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input());

        // The fix: thinness is judged RELATIVE TO THE SOURCE; a terse-but-faithful note
        // on a sparse transcript is correct and must not be capped at <=0.4.
        Assert.Contains("Judge thinness RELATIVE TO THE SOURCE", prompt);
        Assert.Contains("do NOT auto-fail it for length", prompt);

        // The old blanket "<= 0.4 no matter how accurate" auto-fail must be gone.
        Assert.DoesNotContain("no matter how accurate", prompt);
    }

    [Fact]
    public void Content_rubric_still_penalises_dropping_real_content_when_the_source_is_rich()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input());

        // Terseness leniency must not become a free pass: a thin note over a RICH source is
        // still a major failure.
        Assert.Contains("transcript is rich", prompt);
        Assert.Contains("MAJOR failure", prompt);
    }

    [Fact]
    public void Content_rubric_still_forbids_padding_and_invention()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input());

        Assert.Contains("Never reward padding", prompt);
        Assert.Contains("no facts absent from the source", prompt);
    }

    [Fact]
    public void Prompt_lists_grounded_entities_as_a_never_flag_allowlist()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(
            Input(groundedEntities: ["stark industries", "reorg"]));

        // Each grounded entity is enumerated and the block forbids flagging them.
        Assert.Contains("GROUNDED ENTITIES", prompt);
        Assert.Contains("stark industries", prompt);
        Assert.Contains("reorg", prompt);
        Assert.Contains("NEVER", prompt);
    }

    [Fact]
    public void Prompt_omits_the_allowlist_block_when_there_are_no_grounded_entities()
    {
        var prompt = BedrockQualityJudge.BuildPrompt(Input(groundedEntities: []));

        Assert.DoesNotContain("GROUNDED ENTITIES", prompt);
    }
}
