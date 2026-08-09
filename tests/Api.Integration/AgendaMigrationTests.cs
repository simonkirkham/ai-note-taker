using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

// Phase 43-H1 — the migration writes into the user's REAL note content, so every test here drives
// the live endpoint: real auth, real ?apply binding, the real NoteCommandHandler (ownership check,
// hash guard, append-retry) and the real event store. The previous version of these tests
// instantiated the handler with fakes and so proved none of that.
//
// Measured scope at build time (prod, 2026-08-08): 8 notes, 36 topics.
[Collection("AgendaMigration")]
public sealed class AgendaMigrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    private async Task<string> CreateNoteAsync(string content, params string[] legacyTopics)
    {
        var create = await _client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString()!;
        if (content.Length > 0)
            await _client.PutAsync($"/notes/{noteId}/content", JsonContent.Create(new { content }));
        foreach (var text in legacyTopics)
            await _client.PostAsync($"/notes/{noteId}/agenda-items", JsonContent.Create(new { text }));
        return noteId;
    }

    private async Task TickAsync(string noteId, string text)
    {
        var detail = await _client.GetFromJsonAsync<JsonElement>($"/notes/{noteId}");
        var itemId = detail.GetProperty("agenda").EnumerateArray()
            .First(a => a.GetProperty("text").GetString() == text)
            .GetProperty("itemId").GetString();
        await _client.PutAsync($"/notes/{noteId}/agenda-items/{itemId}/discussed",
            JsonContent.Create(new { discussed = true }));
    }

    private async Task<JsonElement> MigrateAsync(bool apply) =>
        await (await _client.PostAsync($"/admin/agenda/migrate?apply={apply}", null))
            .Content.ReadFromJsonAsync<JsonElement>();

    private static JsonElement NoteIn(JsonElement result, string noteId) =>
        result.GetProperty("notes").EnumerateArray()
            .Single(n => n.GetProperty("noteId").GetString() == noteId.Replace("-", ""));

    private static bool Mentions(JsonElement result, string noteId) =>
        result.GetProperty("notes").EnumerateArray()
            .Any(n => n.GetProperty("noteId").GetString() == noteId.Replace("-", ""));

    private async Task<string> ContentOfAsync(string noteId) =>
        (await _client.GetFromJsonAsync<JsonElement>($"/notes/{noteId}"))
            .GetProperty("content").GetString()!;

    [Fact]
    public async Task Writes_legacy_topics_into_the_body_as_a_checklist_preserving_ticked_state()
    {
        var noteId = await CreateNoteAsync("Rob says cloud spend is 8% over.", "Travel", "Timesheet");
        await TickAsync(noteId, "Timesheet");

        await MigrateAsync(apply: true);

        var content = await ContentOfAsync(noteId);
        Assert.Contains("- [ ] Travel", content);
        Assert.Contains("- [x] Timesheet", content);
    }

    [Fact]
    public async Task Preserves_every_word_of_the_existing_note_below_the_checklist()
    {
        const string body = "Rob says cloud spend is 8% over.\n\nMoved on to hiring — two open reqs.";
        var noteId = await CreateNoteAsync(body, "Travel");

        await MigrateAsync(apply: true);

        Assert.EndsWith(body, await ContentOfAsync(noteId));
    }

    [Fact]
    public async Task Keeps_capture_order()
    {
        var noteId = await CreateNoteAsync("Notes.", "First", "Second", "Third");

        await MigrateAsync(apply: true);

        var content = await ContentOfAsync(noteId);
        Assert.True(content.IndexOf("First", StringComparison.Ordinal) < content.IndexOf("Second", StringComparison.Ordinal));
        Assert.True(content.IndexOf("Second", StringComparison.Ordinal) < content.IndexOf("Third", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Handles_a_note_whose_body_is_empty()
    {
        var noteId = await CreateNoteAsync("", "How are the teams doing?");

        await MigrateAsync(apply: true);

        Assert.Equal("- [ ] How are the teams doing?", (await ContentOfAsync(noteId)).Trim());
    }

    // The property that makes a re-run after a partial failure safe.
    [Fact]
    public async Task Is_idempotent_a_second_run_leaves_the_note_untouched()
    {
        var noteId = await CreateNoteAsync("Prose.", "Travel");
        await MigrateAsync(apply: true);
        var afterFirst = await ContentOfAsync(noteId);

        var second = await MigrateAsync(apply: true);

        Assert.Equal(afterFirst, await ContentOfAsync(noteId));
        Assert.False(Mentions(second, noteId));
    }

    [Fact]
    public async Task Skips_a_topic_already_in_the_body_but_migrates_its_siblings()
    {
        var noteId = await CreateNoteAsync("- [ ] Travel\n\nProse.", "Travel", "Timesheet");

        await MigrateAsync(apply: true);

        var content = await ContentOfAsync(noteId);
        Assert.Contains("- [ ] Timesheet", content);
        Assert.Equal(1, content.Split("Travel").Length - 1);
    }

    // The editor re-serialises text with backslash escapes on the next save, so a literal comparison
    // would miss an already-migrated topic and duplicate it.
    [Fact]
    public async Task Matches_an_already_migrated_topic_through_markdown_escapes()
    {
        var noteId = await CreateNoteAsync(@"- [ ] Review Q3 \[draft\]", "Review Q3 [draft]");

        var result = await MigrateAsync(apply: true);

        Assert.False(Mentions(result, noteId));
    }

    // Explicit 43-H acceptance criterion: a body line the user has emphasised is the SAME topic.
    [Fact]
    public async Task Matches_an_already_migrated_topic_through_emphasis()
    {
        var noteId = await CreateNoteAsync("- [ ] **Budget**", "Budget");

        var result = await MigrateAsync(apply: true);

        Assert.False(Mentions(result, noteId));
        Assert.Equal("- [ ] **Budget**", (await ContentOfAsync(noteId)).Trim());
    }

    // AddAgendaItem only trimmed, so a legacy topic can hold a newline. Written raw it would break
    // the checklist into a line Parse cannot match, and every re-run would list it again.
    [Fact]
    public async Task Flattens_a_topic_that_contains_a_newline_and_stays_idempotent()
    {
        var noteId = await CreateNoteAsync("Prose.", "Budget\nand headcount");

        await MigrateAsync(apply: true);
        var afterFirst = await ContentOfAsync(noteId);
        await MigrateAsync(apply: true);

        Assert.Contains("- [ ] Budget and headcount", afterFirst);
        Assert.Equal(afterFirst, await ContentOfAsync(noteId));
    }

    [Fact]
    public async Task Leaves_a_note_with_no_legacy_topics_alone()
    {
        var noteId = await CreateNoteAsync("- [ ] Budget\n\nProse only.");

        var result = await MigrateAsync(apply: true);

        Assert.False(Mentions(result, noteId));
        Assert.Equal("- [ ] Budget\n\nProse only.", await ContentOfAsync(noteId));
    }

    [Fact]
    public async Task Dry_run_writes_nothing_and_reports_the_content_it_would_write()
    {
        var noteId = await CreateNoteAsync("Prose.", "Travel", "Timesheet");

        var result = await MigrateAsync(apply: false);

        Assert.True(result.GetProperty("dryRun").GetBoolean());
        Assert.Equal("Prose.", await ContentOfAsync(noteId));
        var line = NoteIn(result, noteId);
        Assert.Equal("would migrate", line.GetProperty("outcome").GetString());
        Assert.Equal(2, line.GetProperty("topics").GetInt32());
        // The whole resulting body, so it can be read before ?apply=true — not just a byte delta.
        Assert.Equal("- [ ] Travel\n- [ ] Timesheet\n\nProse.", line.GetProperty("resultingContent").GetString());
    }

    [Fact]
    public async Task Missing_apply_parameter_is_a_dry_run()
    {
        var noteId = await CreateNoteAsync("Prose.", "Travel");

        var result = await (await _client.PostAsync("/admin/agenda/migrate", null))
            .Content.ReadFromJsonAsync<JsonElement>();

        Assert.True(result.GetProperty("dryRun").GetBoolean());
        Assert.Equal("Prose.", await ContentOfAsync(noteId));
    }

    [Fact]
    public async Task Requires_authentication()
    {
        var anonymous = factory.CreateUnauthenticatedClient();

        var resp = await anonymous.PostAsync("/admin/agenda/migrate", null);

        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    // C2: the scan must never reach another user's notes — not to migrate them, and not to disclose
    // their ids and titles in the report.
    [Fact]
    public async Task Never_touches_or_reports_another_users_note()
    {
        var mine = await CreateNoteAsync("Mine.", "Travel");
        var theirs = await CreateNoteAsAsync(ApiFactory.OtherTestUserId, "Theirs.", "Their topic");

        var result = await MigrateAsync(apply: true);

        Assert.True(Mentions(result, mine));
        Assert.False(Mentions(result, theirs));
        Assert.DoesNotContain("Their topic", result.ToString());
    }

    private async Task<string> CreateNoteAsAsync(string userId, string content, string topic)
    {
        var other = factory.CreateClient();
        other.DefaultRequestHeaders.Remove("X-Test-User-Id");
        other.DefaultRequestHeaders.Add("X-Test-User-Id", userId);
        var create = await other.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString()!;
        await other.PutAsync($"/notes/{noteId}/content", JsonContent.Create(new { content }));
        await other.PostAsync($"/notes/{noteId}/agenda-items", JsonContent.Create(new { text = topic }));
        return noteId;
    }

    // A deleted note is dropped by the fold, so its topics are never resurrected — and an
    // EditContent against it would 404 mid-batch.
    [Fact]
    public async Task Never_resurrects_a_deleted_note()
    {
        var noteId = await CreateNoteAsync("Gone.", "Topic 1");
        await _client.DeleteAsync($"/notes/{noteId}");

        var result = await MigrateAsync(apply: true);

        Assert.False(Mentions(result, noteId));
    }
}
