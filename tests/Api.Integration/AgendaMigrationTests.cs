using Api.CommandHandlers;
using Domain.Notes;
using EventStore.Projections;

namespace Api.Integration;

// Phase 43-H1 — the migration writes into the user's REAL note content, so these pin the three
// properties that make that safe: nothing else in the note changes, a re-run cannot double-list,
// and ticked state survives. Measured scope at build time: 8 notes, 36 topics.
public sealed class AgendaMigrationTests
{
    private static (AgendaMigrationHandler Handler, InMemoryNoteDetailStore Store, RecordingCommandHandler Commands)
        Subject(params NoteDetailView[] notes)
    {
        var store = new InMemoryNoteDetailStore();
        foreach (var n in notes) store.UpsertAsync(n).GetAwaiter().GetResult();
        var commands = new RecordingCommandHandler();
        return (new AgendaMigrationHandler(store, commands), store, commands);
    }

    private static NoteDetailView Note(string content, params AgendaItemView[] agenda) =>
        new(new NoteId(Guid.NewGuid()), "Catch up", content, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow,
            UserId: "user-1", Agenda: agenda);

    private static AgendaItemView Legacy(string text, bool discussed = false, int position = 0) =>
        new(Guid.NewGuid(), text, discussed, position, Derived: false);

    private static AgendaItemView Derived(string text, bool discussed = false, int position = 0) =>
        new(Guid.NewGuid(), text, discussed, position, Derived: true);

    [Fact]
    public async Task Writes_legacy_topics_into_the_body_as_a_checklist()
    {
        var (handler, _, commands) = Subject(Note("Rob says cloud spend is 8% over.",
            Legacy("Travel", position: 0), Legacy("Timesheet", discussed: true, position: 1)));

        var result = await handler.MigrateAsync(dryRun: false);

        Assert.Equal(1, result.NotesMigrated);
        Assert.Equal(2, result.TopicsMigrated);
        var written = Assert.Single(commands.Edits).Content;
        Assert.Contains("- [ ] Travel", written);
        Assert.Contains("- [x] Timesheet", written);
    }

    [Fact]
    public async Task Preserves_every_word_of_the_existing_note()
    {
        const string body = "Rob says cloud spend is 8% over.\n\nMoved on to hiring — two open reqs.";
        var (handler, _, commands) = Subject(Note(body, Legacy("Travel")));

        await handler.MigrateAsync(dryRun: false);

        var written = Assert.Single(commands.Edits).Content;
        Assert.EndsWith(body, written);
        Assert.Contains("- [ ] Travel\n\n", written);
    }

    [Fact]
    public async Task Keeps_capture_order()
    {
        var (handler, _, commands) = Subject(Note("Notes.",
            Legacy("Third", position: 2), Legacy("First", position: 0), Legacy("Second", position: 1)));

        await handler.MigrateAsync(dryRun: false);

        var written = Assert.Single(commands.Edits).Content;
        Assert.True(written.IndexOf("First", StringComparison.Ordinal) < written.IndexOf("Second", StringComparison.Ordinal));
        Assert.True(written.IndexOf("Second", StringComparison.Ordinal) < written.IndexOf("Third", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Handles_a_note_whose_body_is_empty()
    {
        var (handler, _, commands) = Subject(Note("", Legacy("How are the teams doing?")));

        await handler.MigrateAsync(dryRun: false);

        Assert.Equal("- [ ] How are the teams doing?", Assert.Single(commands.Edits).Content.TrimEnd());
    }

    // The property that makes a re-run after a partial failure safe.
    [Fact]
    public async Task Is_idempotent_a_second_run_writes_nothing()
    {
        var note = Note("Prose.", Legacy("Travel"));
        var (handler, store, commands) = Subject(note);

        await handler.MigrateAsync(dryRun: false);
        var afterFirst = commands.Edits.Count;
        // Reflect the migration in the store, as the projector would.
        await store.UpsertAsync(note with { Content = commands.Edits[^1].Content });

        var second = await handler.MigrateAsync(dryRun: false);

        Assert.Equal(afterFirst, commands.Edits.Count);
        Assert.Equal(0, second.NotesMigrated);
        Assert.Equal(1, second.NotesSkipped);
    }

    [Fact]
    public async Task Skips_a_topic_already_in_the_body_but_migrates_its_siblings()
    {
        var (handler, _, commands) = Subject(Note("- [ ] Travel\n\nProse.",
            Legacy("Travel", position: 0), Legacy("Timesheet", position: 1)));

        var result = await handler.MigrateAsync(dryRun: false);

        Assert.Equal(1, result.TopicsMigrated);
        var written = Assert.Single(commands.Edits).Content;
        Assert.Contains("- [ ] Timesheet", written);
        // "Travel" appears once — the body's original line, not a duplicate.
        Assert.Equal(1, written.Split("Travel").Length - 1);
    }

    // The editor re-serialises text with backslash escapes on the next save, so a literal comparison
    // would miss an already-migrated topic and duplicate it.
    [Fact]
    public async Task Matches_an_already_migrated_topic_through_markdown_escapes()
    {
        var (handler, _, _) = Subject(Note(@"- [ ] Review Q3 \[draft\]", Legacy("Review Q3 [draft]")));

        var result = await handler.MigrateAsync(dryRun: false);

        Assert.Equal(0, result.NotesMigrated);
        Assert.Equal(1, result.NotesSkipped);
    }

    [Fact]
    public async Task Leaves_notes_with_no_legacy_topics_alone()
    {
        var (handler, _, commands) = Subject(
            Note("Prose only."),
            Note("- [ ] Budget", Derived("Budget")));

        var result = await handler.MigrateAsync(dryRun: false);

        Assert.Empty(commands.Edits);
        Assert.Equal(0, result.NotesMigrated);
        Assert.Equal(2, result.NotesScanned);
    }

    [Fact]
    public async Task Dry_run_reports_what_it_would_do_and_writes_nothing()
    {
        var (handler, _, commands) = Subject(Note("Prose.", Legacy("Travel"), Legacy("Timesheet")));

        var result = await handler.MigrateAsync(dryRun: true);

        Assert.Empty(commands.Edits);
        Assert.Equal(1, result.NotesMigrated);
        Assert.Equal(2, result.TopicsMigrated);
        Assert.Contains(result.Details, d => d.Contains("would migrate"));
    }

    private sealed class RecordingCommandHandler : INoteCommandHandler
    {
        public List<EditContent> Edits { get; } = [];

        public Task<long> HandleAsync(NoteCommand cmd, CancellationToken ct = default)
        {
            if (cmd is EditContent edit) Edits.Add(edit);
            return Task.FromResult(1L);
        }

        public Task<long> HandleAsync(NoteCommand cmd, string userId, string? workspaceId, CancellationToken ct = default) =>
            HandleAsync(cmd, ct);

        public Task<long> GetCurrentVersionAsync(NoteId noteId, CancellationToken ct = default) =>
            Task.FromResult(1L);
    }
}
