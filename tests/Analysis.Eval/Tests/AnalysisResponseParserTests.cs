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

        var result = AnalysisResponseParser.Parse(text, "amazon.nova-lite-v1:0", "analysis@v1");

        Assert.Equal("Team synced on checkout.", result.Summary);
        Assert.Equal(["Stripe retries flaky", "Launch on hold"], result.DiscussionPoints);
        Assert.Equal(["Hold launch until green"], result.Decisions);
        Assert.Equal(["checkout-redesign", "stripe"], result.NewTags);
        Assert.Equal(["Enable beta flag"], result.NewActionItems);
        Assert.Equal("amazon.nova-lite-v1:0", result.ModelId);
        Assert.Equal("analysis@v1", result.PromptVersion);
    }

    [Fact]
    public void No_json_falls_back_to_empty_result_but_keeps_stamp()
    {
        var result = AnalysisResponseParser.Parse("I could not analyse that.", "model-x", "analysis@v1");

        Assert.Equal("", result.Summary);
        Assert.Empty(result.DiscussionPoints);
        Assert.Empty(result.Decisions);
        Assert.Empty(result.NewTags);
        Assert.Empty(result.NewActionItems);
        Assert.Equal("model-x", result.ModelId);
        Assert.Equal("analysis@v1", result.PromptVersion);
    }

    [Fact]
    public void Malformed_json_falls_back_to_empty_result()
    {
        var result = AnalysisResponseParser.Parse("{ \"summary\": ", "model-x", "analysis@v1");

        Assert.Equal("", result.Summary);
        Assert.Empty(result.NewActionItems);
    }

    [Fact]
    public void Missing_fields_default_to_empty_and_blank_entries_are_dropped()
    {
        var text = """{ "summary": "Just a summary", "newTags": ["a", "", " "] }""";

        var result = AnalysisResponseParser.Parse(text, "m", "p");

        Assert.Equal("Just a summary", result.Summary);
        Assert.Empty(result.Decisions);
        Assert.Equal(["a"], result.NewTags);
    }
}
