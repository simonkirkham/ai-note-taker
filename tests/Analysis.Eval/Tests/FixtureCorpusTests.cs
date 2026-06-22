namespace Analysis.Eval.Tests;

// Offline guards on the fixture corpus — no Bedrock. These catch authoring
// mistakes before a (paid) eval run and encode the corpus design rules:
// tags are proper nouns only (named orgs/clients, the person a meeting is ABOUT,
// named products/projects) per MPI-8 — a fixture with no proper noun carries an
// intentionally EMPTY tag set as a restraint case — and only the current user's
// actions belong in actionItems — everyone else's go into contentMustMention.
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
        Assert.True(f.Expected.ActionItems.Count >= 1, $"{id}: expected at least one user action item");
        Assert.True(f.Expected.ContentMustMention.Count >= 1,
            $"{id}: expected at least one other-party fact in contentMustMention");
    }

    // MPI-8: tags are proper nouns only, so a fixture with no named entity carries an empty
    // tag set on purpose. Guard the corpus shape instead of every row: the vast majority must
    // still exercise tagging, and every non-empty tag must be lowercase + hyphenated (the stored
    // form), never a stray meeting-type. A handful of deliberate zero-tag restraint fixtures is fine.
    [Fact]
    public void Most_fixtures_carry_proper_noun_tags_and_all_tags_are_normalised()
    {
        var tagged = Fixtures.Count(f => f.Expected.Tags.Count > 0);
        Assert.True(tagged >= Fixtures.Count - 4,
            $"expected most fixtures to carry tags; only {tagged}/{Fixtures.Count} do");

        var malformed = Fixtures
            .SelectMany(f => f.Expected.Tags.Select(t => (f.Id, t)))
            .Where(x => x.t != x.t.Trim().ToLowerInvariant() || x.t.Contains(' '))
            .ToList();
        Assert.True(malformed.Count == 0,
            $"tags must be lowercase + hyphenated: {string.Join(", ", malformed.Select(x => $"{x.Id}:{x.t}"))}");
    }

    // A cheap proxy for the user-scoping rule: the user's actions and the content
    // facts must be disjoint sets. This does NOT prove per-speaker attribution
    // (the JSON has no speaker labels) — an other-party action wrongly placed in
    // actionItems would still pass. True attribution is verified by hand at
    // authoring time; the live Action-F1 precision score is what catches leakage
    // at eval time.
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
