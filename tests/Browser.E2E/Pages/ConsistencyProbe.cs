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
// What closes it: the REQUEST's outbound `If-Consistent-With`, recorded from inside a Playwright
// route — the point at which the header the test injects and the header the app sends are both
// visible.
//
// The third and fourth states matter as much as the first two. A request that is issued and never
// answered, or one ABORTED by the next `ReloadAsync()` before the server's 8 s gate cap elapses,
// looks identical to "no request" in a response-only log — and abort is the shape a per-attempt
// timeout shorter than the server gate produces. Recording issue, answer and abort separately is
// what makes them visible.
//
// Safety: records only the route's own header dictionary and the response's synchronous
// `.Status`/`.Headers`. Never a response body — `TextAsync()` on a response aborted by a reload
// loop never resolves and hung the suite for 44 min (PR #291).
//
// Concurrency: Playwright raises Response/RequestFailed on its dispatcher thread while the test
// thread reads the log. Every field of an entry is mutable and several are read together, so a
// per-field `volatile` would not be enough — one lock guards the whole list instead, and no lock is
// ever held across an await.
public sealed class ConsistencyProbe
{
    public const string Ungated = "<none>";

    private const int MaxEntries = 200;

    private sealed class Entry
    {
        public int Seq;
        public string Label = "";
        public string Method = "";
        public string Url = "";
        public string Outbound = Ungated;
        public IRequest? Request;
        public int? Status;
        public string? ConsistencyHeader;
        public string? Failure;
        public bool Answered => Status is not null || Failure is not null;
    }

    private readonly List<Entry> entries = new();
    private readonly object gate = new();
    private int nextSeq;

    // Guarded by `gate`, like everything else here. See Find().
    private int fallbackMatches;

    // Call from a route handler. Returns the header set to continue with — the request's own
    // headers, plus `If-Consistent-With` when `injectToken` is supplied. Playwright's
    // ContinueAsync REPLACES the whole header set, so it must start from the request's own
    // headers or Authorization is dropped.
    //
    // `label` names the helper that installed the route, so one journey's cards reads and its
    // actions reads stay distinguishable in a single dump.
    public async Task<Dictionary<string, string>> RecordRequestAsync(IRoute route, string? injectToken, string label)
    {
        // The IPC round-trip happens BEFORE the lock — never hold it across an await.
        var headers = await route.Request.AllHeadersAsync().ConfigureAwait(false);
        var outbound = headers.TryGetValue("if-consistent-with", out var existing) && !string.IsNullOrWhiteSpace(existing)
            ? existing
            : null;

        if (!string.IsNullOrEmpty(injectToken))
        {
            headers["if-consistent-with"] = injectToken;
            outbound = injectToken;
        }

        var entry = new Entry
        {
            Label = label,
            Method = route.Request.Method,
            Url = route.Request.Url,
            Outbound = outbound ?? Ungated,
            Request = route.Request,
        };

        lock (gate)
        {
            entry.Seq = ++nextSeq;
            entries.Add(entry);
            // Bounded like the sibling logs in AppPage: a page in a fetch loop must not grow this
            // without limit, and the dump only ever reads the tail.
            if (entries.Count > MaxEntries) entries.RemoveRange(0, entries.Count - MaxEntries);
        }

        return new Dictionary<string, string>(headers);
    }

    // Call from the page's Response event. Reads only synchronous properties.
    public void RecordResponse(IResponse response)
    {
        var request = response.Request;
        lock (gate)
        {
            var match = Find(request, request.Method, response.Url);
            if (match is null) return;
            match.Status = response.Status;
            match.ConsistencyHeader = response.Headers.TryGetValue("x-consistency", out var c) ? c : null;
        }
    }

    // Call from the page's RequestFailed event. A reload ABORTS the in-flight gated read, and
    // Playwright then raises RequestFailed and never Response. Closing the entry here is what stops
    // it absorbing the NEXT iteration's response — which would erase the aborted state entirely and
    // report the later, possibly differently-gated read against this entry.
    public void RecordFailure(IRequest request, string? failure)
    {
        lock (gate)
        {
            var match = Find(request, request.Method, request.Url);
            if (match is null) return;
            match.Failure = string.IsNullOrEmpty(failure) ? "aborted" : failure;
        }
    }

    // Reference identity first, method+URL second.
    //
    // Whether Playwright hands the SAME IRequest to the route and to the Response/RequestFailed
    // events is not something this code asserts — the previous version of this file did assert the
    // opposite, untested, and that assumption is exactly why it used the weaker match and
    // mis-attributed replies during a reload loop. Correctness no longer depends on the answer:
    // identity is tried first and the fallback is narrow (oldest unanswered wins). But the answer
    // is worth knowing, so every fallback hit is COUNTED and printed in the summary. If a dump ever
    // shows `matched-by-url` climbing, identity is not preserved and the fallback is carrying the
    // correlation — which is the point at which its limits start to matter.
    private Entry? Find(IRequest request, string method, string url)
    {
        foreach (var e in entries)
            if (!e.Answered && ReferenceEquals(e.Request, request)) return e;

        foreach (var e in entries)
            if (!e.Answered && e.Method == method && string.Equals(e.Url, url, StringComparison.Ordinal))
            {
                fallbackMatches++;
                return e;
            }

        return null;
    }

    // The verdict per read. This is the whole point of the probe: `ungated` and `gated-fresh` were
    // previously the same observation.
    private static string Verdict(Entry e)
    {
        var gated = e.Outbound != Ungated ? "GATED" : "UNGATED";
        if (e.Failure is not null) return $"{gated}-ABORTED({e.Failure})";
        if (e.Status is null) return $"{gated}-UNANSWERED";
        if (e.Outbound == Ungated) return "UNGATED";
        return e.ConsistencyHeader == "stale" ? "GATED-stale" : "GATED-fresh";
    }

    private static string Render(Entry e) =>
        $"#{e.Seq} [{e.Label}] {e.Method} {Verdict(e)} sent={e.Outbound} " +
        $"-> {(e.Status is null ? "no status" : e.Status.ToString())} {e.Url}";

    public IReadOnlyList<string> Lines(int take = 12)
    {
        lock (gate)
            return entries.TakeLast(take).Select(Render).ToList();
    }

    public string Summary()
    {
        lock (gate)
        {
            var v = entries.Select(Verdict).ToList();
            return $"reads: gated-fresh={v.Count(x => x == "GATED-fresh")} " +
                   $"gated-stale={v.Count(x => x == "GATED-stale")} " +
                   $"gated-unanswered={v.Count(x => x == "GATED-UNANSWERED")} " +
                   $"gated-aborted={v.Count(x => x.StartsWith("GATED-ABORTED", StringComparison.Ordinal))} " +
                   $"ungated={v.Count(x => x.StartsWith("UNGATED", StringComparison.Ordinal))} " +
                   $"matched-by-url={fallbackMatches}";
        }
    }

    public string Describe(int take = 12) =>
        $"{Summary()} | " + string.Join(" ;; ", Lines(take));

    // Self-check support: the outbound token on the FIRST GET matching `urlPart`, or null when no
    // such read was recorded — the caller must treat null as a failure, never as a reportable
    // value, or a probe that observed nothing is indistinguishable from one that discriminated.
    //
    // FIRST, not last, and the distinction cost a 4-in-10 flake. A reload produces MORE THAN ONE
    // actions read: the note screen mounts and reads (carrying the persisted token, which the
    // server answers non-stale, so `gatedRead` then CLEARS it), and opening the popover refetches —
    // ungated, because the token it would have used has just been consumed. Reporting the last read
    // therefore reported the app's second, ungated refetch and called the gating absent. The read
    // whose gating is under test is the first one after the reload.
    //
    // GET only: the POST that adds an action matches the same URL and would otherwise be reported
    // as the read's gating.
    public string? FirstOutboundFor(string urlPart)
    {
        lock (gate)
        {
            foreach (var e in entries)
                if (e.Method == "GET" && e.Url.Contains(urlPart, StringComparison.OrdinalIgnoreCase))
                    return e.Outbound;
            return null;
        }
    }

    public int CountReadsFor(string urlPart)
    {
        lock (gate)
            return entries.Count(e =>
                e.Method == "GET" && e.Url.Contains(urlPart, StringComparison.OrdinalIgnoreCase));
    }

    public void Clear()
    {
        lock (gate) entries.Clear();
    }
}
