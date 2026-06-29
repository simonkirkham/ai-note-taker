using Api.Services;

namespace Analysis.Eval.Tests;

public class InstructionExtractorTests
{
    [Fact]
    public void No_marker_returns_content_unchanged_and_no_instructions()
    {
        var (content, instructions) = InstructionExtractor.Extract("Just some notes.\nSecond line.");

        Assert.Equal("Just some notes.\nSecond line.", content);
        Assert.Empty(instructions);
    }

    [Fact]
    public void Extracts_a_marker_line_and_strips_it_from_content()
    {
        var (content, instructions) = InstructionExtractor.Extract(
            "budget approved\n/ai add an agenda for the weekend\nchase Sam");

        Assert.Equal(["add an agenda for the weekend"], instructions);
        Assert.Equal("budget approved\nchase Sam", content);
    }

    [Fact]
    public void Extracts_multiple_instructions_in_order()
    {
        var (_, instructions) = InstructionExtractor.Extract("/ai first\nnote\n/ai second");

        Assert.Equal(["first", "second"], instructions);
    }

    [Fact]
    public void Tolerates_a_leading_list_marker_and_indentation()
    {
        var (content, instructions) = InstructionExtractor.Extract("- /ai do the thing\n  * /ai another");

        Assert.Equal(["do the thing", "another"], instructions);
        Assert.Equal("", content);
    }

    [Fact]
    public void Marker_match_is_case_insensitive()
    {
        var (_, instructions) = InstructionExtractor.Extract("/AI shout\n/Ai whisper");

        Assert.Equal(["shout", "whisper"], instructions);
    }

    [Fact]
    public void Mid_line_marker_is_not_an_instruction()
    {
        var (content, instructions) = InstructionExtractor.Extract("see path/ai/config for details");

        Assert.Empty(instructions);
        Assert.Equal("see path/ai/config for details", content);
    }

    [Fact]
    public void Marker_must_be_followed_by_whitespace()
    {
        var (content, instructions) = InstructionExtractor.Extract("/airplane mode is on");

        Assert.Empty(instructions);
        Assert.Equal("/airplane mode is on", content);
    }

    [Fact]
    public void Bare_marker_with_no_text_is_dropped_not_an_empty_instruction()
    {
        var (content, instructions) = InstructionExtractor.Extract("note\n/ai   \nmore");

        Assert.Empty(instructions);
        Assert.Equal("note\nmore", content);
    }

    [Fact]
    public void Null_or_empty_content_is_safe()
    {
        var (c1, i1) = InstructionExtractor.Extract(null);
        var (c2, i2) = InstructionExtractor.Extract("");

        Assert.Equal("", c1);
        Assert.Empty(i1);
        Assert.Equal("", c2);
        Assert.Empty(i2);
    }
}
