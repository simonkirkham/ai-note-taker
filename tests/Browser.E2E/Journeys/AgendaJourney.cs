using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// Phase 43-F + 43-G in ONE journey, deliberately.
//
// 43-F made every task-list line in a note body a topic on its agenda; 43-G made the header strip
// write back into that body. Both halves are the same loop — body ↔ header — so one journey proves
// them, and the deploy gate is the project's bottleneck: every recent gate journey (BUG-38, BUG-61,
// BUG-62, the 44-minute hang, the CHANGE-23 re-cut) cost more than the bug it caught, so halving
// the flake surface is worth more than two narrower tests. Do not add a second agenda journey.
//
// Both assertions are projector-backed: the agenda is derived from the note CONTENT, so the pill
// only moves after the content saves, the projector folds it, and the note-detail read returns.
// Hence the reload-tolerant helper rather than a bare ToBeVisible.
[Collection("E2E Journeys")]
public sealed class AgendaJourney(BrowserFixture browser) : IAsyncLifetime
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
        _app = new AppPage(_page, browser.FrontendUrl, browser.E2EAuthToken);
    }

    public async Task DisposeAsync()
    {
        await _context.Tracing.StopAsync(new() { Path = "trace-agenda.zip" });
        await _context.DisposeAsync();
    }

    [E2EFact]
    public async Task A_checklist_line_is_a_topic_and_the_header_writes_one_back()
    {
        var title = $"Agenda {Guid.NewGuid():N}"[..20];

        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();
        await _app.AssertNoteScreenLoadedAsync();
        await _app.EnterTitleAsync(title);

        // 43-F — a task line typed into the body becomes a topic. The markdown input rule turns
        // "[] " into a real task item, so this is the user's actual keystrokes, not a seeded doc.
        await _app.TypeIntoNoteBodyAndSaveAsync("[] Budget Q3");
        await _app.AssertAgendaCoverageAfterReloadAsync("0 / 1");

        // 43-G — adding from the HEADER puts the line into the note body. Proves the write-back
        // direction: nothing was typed into the editor here.
        await _app.AddAgendaTopicFromHeaderAsync("Hiring plan");
        await _app.AssertNoteBodyContainsAsync("Hiring plan");

        // And it is a real topic, not just text: the count reflects it once the edit has saved and
        // the projector has folded it.
        await _app.AssertAgendaCoverageAfterReloadAsync("0 / 2");
    }
}
