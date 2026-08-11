using System.Collections.Concurrent;
using Microsoft.Playwright;

namespace Browser.E2E.Pages;

// BUG-79. The probe that says whether a read-your-writes read actually WAITED for the projector.
//
// What the previous diagnostic could not do. It reported only the RESPONSE header, and the server
// sets `X-Consistency` on a stale read ONLY (NoteHandlers/ActionItemHandlers) — so its absence
// covers two opposite states: "the read was gated and the projector was caught up" and "the read
// carried no token at all and merely raced the projector". The old label said `none/fresh` and its
// own comment admitted the ambiguity. Every explanation of the flake forks on exactly that
// distinction, so the evidence could never settle it.
//
// What closes it: the REQUEST's outbound `If-Consistent-With`. That header is only observable from
// inside a Playwright route — `page.Response`'s `request.Headers` is the browser's pre-route view
// and does not show a header the test itself injected, so recording has to happen where the
// injection happens.
//
// The third state matters as much as the first two. A request that is issued and never answered —
// aborted by the next `ReloadAsync()` before the server's 8 s gate cap elapsed — looks identical to
// "no request" in a response-only log, and it is the shape a per-attempt timeout SHORTER than the
// server gate produces. Recording issue and answer separately is what makes it visible.
//
// Safety: records only the route's own header dictionary and the response's synchronous
// `.Status`/`.Headers`. Never a response body — `TextAsync()` on a response aborted by a reload
// loop never resolves and hung the suite for 44 min (PR #291).
public sealed class ConsistencyProbe
{
    public const string Ungated = "<none>";

    private sealed class Entry
    {
        public int Seq;
        public string Method = "";
        public string Url = "";
        public string Outbound = Ungated;
        public int? Status;
        public string? ConsistencyHeader;
    }

    private readonly ConcurrentQueue<Entry> entries = new();
    private int nextSeq;

    // Call from a route handler. Returns the header set to continue with — the request's own
    // headers, plus `If-Consistent-With` when `injectToken` is supplied. Playwright's
    // ContinueAsync REPLACES the whole header set, so it must start from the request's own
    // headers or Authorization is dropped.
    public async Task<Dictionary<string, string>> RecordRequestAsync(IRoute route, string? injectToken)
    {
        var headers = await route.Request.AllHeadersAsync();
        var outbound = headers.TryGetValue("if-consistent-with", out var existing) && !string.IsNullOrWhiteSpace(existing)
            ? existing
            : null;

        if (!string.IsNullOrEmpty(injectToken))
        {
            headers["if-consistent-with"] = injectToken;
            outbound = injectToken;
        }

        entries.Enqueue(new Entry
        {
            Seq = Interlocked.Increment(ref nextSeq),
            Method = route.Request.Method,
            Url = route.Request.Url,
            Outbound = outbound ?? Ungated,
        });

        return new Dictionary<string, string>(headers);
    }

    // Call from the page's Response event. Correlated by (method, url) against the oldest
    // still-unanswered request rather than by object identity, which Playwright does not promise
    // to preserve across the route/response boundary. Reads only synchronous properties.
    public void RecordResponse(IResponse response)
    {
        var match = entries.FirstOrDefault(e =>
            e.Status is null &&
            e.Method == response.Request.Method &&
            string.Equals(e.Url, response.Url, StringComparison.Ordinal));
        if (match is null) return;

        match.Status = response.Status;
        match.ConsistencyHeader = response.Headers.TryGetValue("x-consistency", out var c) ? c : null;
    }

    // The verdict per read. This is the whole point of the probe: `ungated` and `gated-fresh` were
    // previously the same observation.
    private static string Verdict(Entry e)
    {
        if (e.Outbound == Ungated)
            return e.Status is null ? "UNGATED-unanswered" : "UNGATED";
        if (e.Status is null)
            return "GATED-UNANSWERED";
        return e.ConsistencyHeader == "stale" ? "GATED-stale" : "GATED-fresh";
    }

    public IReadOnlyList<string> Lines(int take = 12) =>
        entries.OrderByDescending(e => e.Seq).Take(take).OrderBy(e => e.Seq)
            .Select(e =>
                $"#{e.Seq} {e.Method} {Verdict(e)} sent={e.Outbound} " +
                $"-> {(e.Status is null ? "NO RESPONSE" : e.Status.ToString())} {e.Url}")
            .ToList();

    public int Count(Func<string, bool> verdictMatches) =>
        entries.Count(e => verdictMatches(Verdict(e)));

    // The single-line summary a failure message leads with: how many reads of each kind happened.
    public string Summary() =>
        $"reads: gated-fresh={Count(v => v == "GATED-fresh")} " +
        $"gated-stale={Count(v => v == "GATED-stale")} " +
        $"gated-unanswered={Count(v => v == "GATED-UNANSWERED")} " +
        $"ungated={Count(v => v.StartsWith("UNGATED", StringComparison.Ordinal))}";

    public string Describe(int take = 12) =>
        $"{Summary()} | " + string.Join(" ;; ", Lines(take));

    // Self-check support: the outbound token recorded for the most recent read matching `urlPart`,
    // or null when no such read was recorded. Used by the probe's own journey to prove it reports
    // a gated and an ungated read differently.
    public string? LastOutboundFor(string urlPart) =>
        entries.OrderByDescending(e => e.Seq)
            .FirstOrDefault(e => e.Url.Contains(urlPart, StringComparison.OrdinalIgnoreCase))
            ?.Outbound;

    public void Clear()
    {
        while (entries.TryDequeue(out _)) { }
    }
}
