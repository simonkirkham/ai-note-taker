namespace Analysis.Eval.Tests;

// Offline guards on the fixture corpus — no Bedrock. These catch authoring
// mistakes before a (paid) eval run and encode the corpus design rules:
// tags describe people/companies + work stream + recurring meeting type, and
// only the current user's actions belong in actionItems — everyone else's go
// into contentMustMention.
public class FixtureCorpusTests
{
    static readonly IReadOnlyList<Fixture> Fixtures =
        FixtureLoader.LoadAll(Path.Combine(AppContext.BaseDirectory, "Fixtures"));

    [Fact]
    public void All_fixtures_load_and_the_corpus_is_sizeable()
    {
        Assert.True(Fixtures.Count >= 18, $"expected at least 18 fixtures, found {Fixtures.Count}");
    }

    [Fact]
    public void Fixture_ids_are_unique()
    {
        var dupes = Fixtures.GroupBy(f => f.Id).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
        Assert.True(dupes.Count == 0, $"duplicate fixture ids: {string.Join(", ", dupes)}");
    }

    [Theory]
    [MemberData(nameof(FixtureIds))]
    public void Each_fixture_has_a_user_action_and_an_other_party_fact(string id)
    {
        var f = Fixtures.Single(x => x.Id == id);
        Assert.NotEmpty(f.CurrentUserName);
        Assert.NotEmpty(f.Expected.Tags);
        Assert.True(f.Expected.ActionItems.Count >= 1, $"{id}: expected at least one user action item");
        Assert.True(f.Expected.ContentMustMention.Count >= 1,
            $"{id}: expected at least one other-party fact in contentMustMention");
    }

    // The core rule: an action the user owns must not also be listed as a content
    // fact, and an other-party fact must not be listed as a user action. If these
    // sets overlap, the fixture can't distinguish "captured my action" from
    // "wrongly captured someone else's".
    [Theory]
    [MemberData(nameof(FixtureIds))]
    public void User_actions_and_content_facts_do_not_overlap(string id)
    {
        var f = Fixtures.Single(x => x.Id == id);
        var actions = f.Expected.ActionItems.Select(Normalise).ToHashSet();
        var facts = f.Expected.ContentMustMention.Select(Normalise).ToHashSet();
        Assert.False(actions.Overlaps(facts),
            $"{id}: an item appears in both actionItems and contentMustMention");
    }

    public static IEnumerable<object[]> FixtureIds =>
        FixtureLoader.LoadAll(Path.Combine(AppContext.BaseDirectory, "Fixtures"))
            .Select(f => new object[] { f.Id });

    static string Normalise(string s) =>
        new string(s.ToLowerInvariant().Where(c => char.IsLetterOrDigit(c) || c == ' ').ToArray())
            .Trim();
}
