using System.Text.Json;
using Domain.Notes;
using EventStore.Projections;

namespace Domain.Specs.Projections;

// BUG-76 — the "X / Y" pill and the ticks the user can see must come from the same reading of the
// note body. Since 43-H2 the body is the only source, so the only way they can disagree is this
// parse and the editor's live read diverging — and each divergence is a topic the user can neither
// see in the header nor tick from it.
//
// The equivalence is the invariant, so it is pinned as a SHARED fixture instead of as two sets of
// hand-written assertions that can drift apart. The same file is asserted by
// web/src/__tests__/agendaParity.test.ts against agendaEditorApi.readTopics, so changing either
// reading alone turns the other side red.
public sealed class AgendaParityFixtureSpec
{
    private sealed record FixtureTopic(string Text, bool Checked);

    // `Header` and `Divergence` belong to the client half of the fixture: they record a case where
    // the header knowingly reads something else, and why. This side always asserts `Topics`.
    private sealed record FixtureCase(string Name, string Markdown, FixtureTopic[] Topics);

    private sealed record Fixture(FixtureCase[] Cases);

    // Relative to the repository root, which is located by walking up to the solution file — the
    // test binary's directory is several levels below it and differs between local and CI runs.
    private const string FixturePath = "web/src/__tests__/fixtures/agenda-parity.json";

    // Read once: xUnit calls the member data provider and every test method against the same class.
    private static readonly Lazy<Fixture> Cases = new(Load);

    // The theory carries the case NAME, not the case: xUnit serialises theory arguments into the
    // test id, and a record of topics is neither serialisable nor readable as one.
    public static TheoryData<string> CaseNames()
    {
        var data = new TheoryData<string>();
        foreach (var c in Cases.Value.Cases) data.Add(c.Name);
        return data;
    }

    [Fact]
    public void Every_case_in_the_shared_fixture_is_exercised()
    {
        // Both sides iterate whatever `cases` holds, so DELETING a case silently deletes coverage
        // from this spec and from agendaParity.test.ts at once. The count is pinned in both places;
        // it has to be raised deliberately, in the same commit as the case that raises it.
        Assert.Equal(13, Cases.Value.Cases.Length);
    }

    [Theory]
    [MemberData(nameof(CaseNames))]
    public void The_server_reads_the_topics_the_shared_fixture_records(string name)
    {
        var fixtureCase = Cases.Value.Cases.Single(c => c.Name == name);

        var parsed = AgendaFromContent.Parse(new NoteId(Guid.NewGuid()), fixtureCase.Markdown);

        Assert.Equal(
            fixtureCase.Topics.Select(t => (t.Text, t.Checked)),
            parsed.Select(p => (p.Text, p.Discussed)));
        Assert.Equal(
            Enumerable.Range(0, fixtureCase.Topics.Length),
            parsed.Select(p => p.Position));
    }

    private static Fixture Load()
    {
        var json = File.ReadAllText(Path.Combine(RepositoryRoot(), FixturePath));
        return JsonSerializer.Deserialize<Fixture>(json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException($"{FixturePath} did not deserialise");
    }

    private static string RepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "ai-note-taker.sln")))
            dir = dir.Parent;
        return dir?.FullName
            ?? throw new InvalidOperationException(
                $"ai-note-taker.sln not found above {AppContext.BaseDirectory}");
    }
}
