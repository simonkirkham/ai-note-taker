using Api.Services;

namespace Analysis.Eval.Tests;

public class AnalysisResponseParserTests
{
    [Fact]
    public void Parses_full_json_and_stamps_model_and_prompt()
    {
        var text = """
            Here is the analysis:
            {
              "summary": "Team synced on checkout.",
              "discussion": ["Stripe retries flaky", "Launch on hold"],
              "decisions": ["Hold launch until green"],
              "newTags": ["checkout-redesign", "stripe"],
              "newActionItems": ["Enable beta flag"]
            }
            """;

        var ok = AnalysisResponseParser.TryParse(text, "amazon.nova-lite-v1:0", "analysis@v1", out var result);

        Assert.True(ok);
        Assert.Equal("Team synced on checkout.", result.Summary);
        Assert.Equal(["Stripe retries flaky", "Launch on hold"], result.DiscussionPoints);
        Assert.Equal(["Hold launch until green"], result.Decisions);
        Assert.Equal(["checkout-redesign", "stripe"], result.NewTags);
        Assert.Equal(["Enable beta flag"], result.NewActionItems);
        Assert.Equal("amazon.nova-lite-v1:0", result.ModelId);
        Assert.Equal("analysis@v1", result.PromptVersion);
    }

    [Fact]
    public void No_json_is_a_parse_failure_with_an_empty_stamped_result()
    {
        var ok = AnalysisResponseParser.TryParse("I could not analyse that.", "model-x", "analysis@v1", out var result);

        Assert.False(ok);
        Assert.Equal("", result.Summary);
        Assert.Empty(result.DiscussionPoints);
        Assert.Empty(result.Decisions);
        Assert.Empty(result.NewTags);
        Assert.Empty(result.NewActionItems);
        Assert.Equal("model-x", result.ModelId);
        Assert.Equal("analysis@v1", result.PromptVersion);
    }

    [Fact]
    public void Malformed_json_is_a_parse_failure()
    {
        var ok = AnalysisResponseParser.TryParse("{ \"summary\": ", "model-x", "analysis@v1", out var result);

        Assert.False(ok);
        Assert.Equal("", result.Summary);
    }

    [Fact]
    public void Reversed_braces_do_not_throw_and_are_a_parse_failure()
    {
        var ok = AnalysisResponseParser.TryParse("} then later {", "m", "p", out var result);

        Assert.False(ok);
        Assert.Equal("", result.Summary);
    }

    [Fact]
    public void Valid_json_with_empty_summary_is_a_success_not_a_parse_failure()
    {
        var ok = AnalysisResponseParser.TryParse("{}", "m", "p", out var result);

        Assert.True(ok);
        Assert.Equal("", result.Summary);
        Assert.Empty(result.NewActionItems);
    }

    [Fact]
    public void Missing_fields_default_to_empty_and_blank_entries_are_dropped()
    {
        var text = """{ "summary": "Just a summary", "newTags": ["a", "", " "] }""";

        var ok = AnalysisResponseParser.TryParse(text, "m", "p", out var result);

        Assert.True(ok);
        Assert.Equal("Just a summary", result.Summary);
        Assert.Empty(result.Decisions);
        Assert.Equal(["a"], result.NewTags);
    }

    [Fact]
    public void Parses_instruction_responses_in_order()
    {
        var text = """
            {
              "summary": "A meeting.",
              "instructionResponses": [
                {"instruction": "add an agenda", "response": "1. Review\n2. Plan"},
                {"instruction": "draft an email", "response": "Hi team, ..."}
              ]
            }
            """;

        var ok = AnalysisResponseParser.TryParse(text, "m", "p", out var result);

        Assert.True(ok);
        Assert.NotNull(result.InstructionResponses);
        Assert.Equal(2, result.InstructionResponses!.Count);
        Assert.Equal("add an agenda", result.InstructionResponses[0].Instruction);
        Assert.Equal("1. Review\n2. Plan", result.InstructionResponses[0].Response);
        Assert.Equal("draft an email", result.InstructionResponses[1].Instruction);
    }

    [Fact]
    public void Absent_instruction_responses_is_empty_not_a_failure()
    {
        var ok = AnalysisResponseParser.TryParse("""{ "summary": "A meeting." }""", "m", "p", out var result);

        Assert.True(ok);
        Assert.Empty(result.InstructionResponses!);
    }

    [Fact]
    public void Instruction_responses_missing_a_field_or_blank_response_are_skipped()
    {
        var text = """
            {
              "summary": "A meeting.",
              "instructionResponses": [
                {"instruction": "do a thing"},
                {"instruction": "another", "response": "   "},
                {"instruction": "valid", "response": "done"}
              ]
            }
            """;

        var ok = AnalysisResponseParser.TryParse(text, "m", "p", out var result);

        Assert.True(ok);
        Assert.Single(result.InstructionResponses!);
        Assert.Equal("valid", result.InstructionResponses![0].Instruction);
    }
}
