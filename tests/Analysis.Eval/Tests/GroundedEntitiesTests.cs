using Analysis.Eval.Scoring;

namespace Analysis.Eval.Tests;

// MPI-5: prompt wording alone did not stop the quality judge flagging note/gold-tag
// entities (e.g. "Stark Industries" in 14-all-hands-reorg) as fabrication. The fix is a
// DETERMINISTIC allowlist: the fixture's curated gold tags are grounded by definition, so
// they are humanised and handed to the judge as "never call these fabrication".
public class GroundedEntitiesTests
{
    static Fixture FixtureWithTags(params string[] tags) =>
        new(
            Id: "f",
            TranscriptText: "t",
            ExistingContent: "Stark Industries all-hands follow-up",
            CurrentUserName: "Yuki",
            Expected: new FixtureExpected(Tags: tags, ActionItems: [], ContentMustMention: []));

    [Fact]
    public void Humanises_kebab_case_gold_tags_into_readable_entities()
    {
        var entities = GroundedEntities.From(FixtureWithTags("stark-industries", "all-hands", "reorg"));

        Assert.Contains("stark industries", entities);
        Assert.Contains("all hands", entities);
        Assert.Contains("reorg", entities);
    }

    [Fact]
    public void Deduplicates_and_drops_blank_tags()
    {
        var entities = GroundedEntities.From(FixtureWithTags("reorg", "reorg", "  ", ""));

        Assert.Equal(["reorg"], entities);
    }

    [Fact]
    public void Returns_empty_when_the_fixture_has_no_gold_tags()
    {
        Assert.Empty(GroundedEntities.From(FixtureWithTags()));
    }
}
