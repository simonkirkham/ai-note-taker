using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using E2E.Pages;
using Microsoft.Playwright;

namespace E2E.Journeys;

[Collection("E2E Journeys")]
public sealed class NoteContentJourney(BrowserFixture browser) : IAsyncLifetime
{
    private IBrowserContext _context = null!;
    private AppPage _app = null!;
    private IPage _page = null!;

    public async Task InitializeAsync()
    {
        _context = await browser.Browser.NewContextAsync();
        await _context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true, Sources = true });
        _page = await _context.NewPageAsync();
        _page.Console += (_, msg) => Console.WriteLine($"[browser {msg.Type}] {msg.Text}");
        _page.PageError += (_, err) => Console.WriteLine($"[browser error] {err}");
        _app = new AppPage(_page, browser.FrontendUrl);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace-content.zip" });
        await _context.DisposeAsync();
    }

    [Fact]
    public async Task Opening_a_new_note_shows_an_empty_content_area()
    {
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        await _app.AssertContentAreaVisibleAsync();
    }

    [Fact]
    public async Task Typing_content_and_blurring_saves_it()
    {
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        // EnterContentAsync waits for the PUT /content response — times out if onBlur doesn't fire it
        await _app.EnterContentAsync("Notes from today's standup");
    }

    [Fact]
    public async Task Content_persists_after_navigating_away_and_returning()
    {
        const string content = "Action items: deploy by Friday, update stakeholders";

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.EnterTitleAsync("Persistence test note");
        await _app.EnterContentAsync(content);

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync("Persistence test note");

        await _app.AssertContentValueAsync(content);
    }

    [Fact]
    public async Task Clearing_content_and_blurring_saves_empty_content()
    {
        var apiBase = browser.ApiBaseUrl
            ?? throw new InvalidOperationException("API_BASE_URL must be set for this journey");

        var title = $"Clear test {Guid.NewGuid():N}"[..20];
        using var http = new HttpClient();
        var create = await http.PostAsync($"{apiBase}/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString()!;
        await http.PatchAsync($"{apiBase}/notes/{noteId}/title",
            new StringContent($"{{\"title\":\"{title}\"}}", Encoding.UTF8, "application/json"));
        await http.PutAsync($"{apiBase}/notes/{noteId}/content",
            new StringContent("{\"content\":\"original content\"}", Encoding.UTF8, "application/json"));

        await _app.GotoAsync();
        await _app.ClickNoteInListAsync(title);
        await _app.EnterContentAsync("");  // clear and blur

        await _app.GoBackAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertContentValueAsync("");
    }

    [Fact]
    public async Task Opening_a_note_with_saved_content_shows_that_content()
    {
        var apiBase = browser.ApiBaseUrl
            ?? throw new InvalidOperationException("API_BASE_URL must be set for this journey");

        var title = $"Content journey {Guid.NewGuid():N}"[..28];
        var content = "Today we discussed the roadmap and Q3 priorities.";

        using var http = new HttpClient();
        var create = await http.PostAsync($"{apiBase}/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString()!;
        await http.PatchAsync($"{apiBase}/notes/{noteId}/title",
            new StringContent($"{{\"title\":\"{title}\"}}", Encoding.UTF8, "application/json"));
        await http.PutAsync($"{apiBase}/notes/{noteId}/content",
            new StringContent($"{{\"content\":\"{content}\"}}", Encoding.UTF8, "application/json"));

        await _app.GotoAsync();
        await _app.ClickNoteInListAsync(title);

        await _app.AssertContentValueAsync(content);
    }
}
