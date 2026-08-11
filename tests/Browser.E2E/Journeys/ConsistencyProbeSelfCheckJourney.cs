using Browser.E2E.Pages;
using Microsoft.Playwright;

namespace Browser.E2E.Journeys;

// BUG-79. Not a product journey — this proves the INSTRUMENT, and it exists because the previous
// instrument could not fail in the way the investigation needed it to.
//
// The old diagnostic reported only the response's `X-Consistency` header, which the server sets on
// a stale read ONLY. So a read that waited for the projector and a read that carried no token at
// all produced byte-identical evidence, and the failure message said `none/fresh` — a label whose
// own comment admitted it could not tell them apart. Every candidate explanation of BUG-79 forks on
// exactly that distinction, so the evidence could never settle it.
//
// This test manufactures both states against the deployed app and asserts the probe reports them
// differently:
//   gated   — the app replays the write token it persisted in sessionStorage
//   ungated — the same reload with those persisted tokens deleted first
// One deliberate manipulation separates the two. If the probe ever reports the same thing for both,
// it has stopped discriminating and this goes red — which is the only reason to trust it when it
// says a read was gated.
[Collection("E2E Journeys")]
public sealed class ConsistencyProbeSelfCheckJourney(BrowserFixture browser) : IAsyncLifetime
{
    private IBrowserContext _context = null!;
    private AppPage _app = null!;
    private IPage _page = null!;

    public async Task InitializeAsync()
    {
        _context = await browser.Browser.NewContextAsync();
        _page = await _context.NewPageAsync();
        _app = new AppPage(_page, browser.FrontendUrl, browser.E2EAuthToken);
    }

    public async Task DisposeAsync() => await _context.DisposeAsync();

    [E2EFact]
    public async Task Probe_reports_a_gated_read_differently_from_an_ungated_one()
    {
        await _app.GotoAsync();
        await _app.ClickNewNoteAsync();

        // A write leaves a consistency token in sessionStorage, so the next read is gated.
        await _app.AddActionItemAsync($"probe gated {Guid.NewGuid():N}"[..24]);
        var gated = await _app.ObserveActionsReadTokenAsync();

        // Re-seed a token, then delete it — the same reload, one manipulation apart.
        await _app.AddActionItemAsync($"probe ungated {Guid.NewGuid():N}"[..24]);
        var ungated = await _app.ObserveActionsReadTokenAsync(dropPersistedTokens: true);

        // Evidence rides the THROWN message: xUnit swallows Console output on a passing test and
        // never flushes a hung one.
        Assert.False(
            gated == ungated,
            $"the probe reported the same thing for a gated and an ungated read ('{gated}'), so it " +
            $"cannot tell them apart and no BUG-79 conclusion drawn from it is safe. {_app.DescribeProbe()}");

        Assert.False(
            gated == ConsistencyProbe.Ungated,
            $"expected the app to replay its persisted consistency token on the actions read, but the " +
            $"probe saw none. Either read-your-writes gating is not happening at all, or the probe is " +
            $"blind to the outbound header. {_app.DescribeProbe()}");

        Assert.True(
            ungated == ConsistencyProbe.Ungated,
            $"deleting the persisted tokens should have produced an UNGATED read, but the probe " +
            $"recorded '{ungated}' — the control does not control anything. {_app.DescribeProbe()}");
    }
}
