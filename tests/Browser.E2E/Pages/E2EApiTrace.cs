using Microsoft.Playwright;

namespace Browser.E2E.Pages;

// TEMPORARY DIAGNOSTIC (TI-42 cards-list flake / BUG-31 removed-image flake).
//
// The E2E deploy gate runs in a SEPARATE AWS account with no readable CloudWatch, so server-side
// evidence is invisible to investigation (see docs/learnings/authz-on-async-projection-and-the-
// observability-blindspot.md). This routes the evidence we need through the ONE channel we can read:
// the gh run log, via the Playwright response stream.
//
// For each traced API call it prints, on a single `[api-trace]` line:
//   - METHOD + the FULL request URL — reveals the `/w/{wsId}/...` workspace prefix (the TI-42
//     leading hypothesis is that the cards read is scoped to a non-`__default__` workspace on reload,
//     so the renamed card is filtered out server-side while the gate is still `Fresh`).
//   - the request `X-Consistency-Token` header (what the gate was asked to wait for).
//   - the response `X-Consistency` header (`stale` when the gate gave up; absent = `fresh`).
//   - status + a truncated body (the cards array / note content — shows matched count and whether
//     the expected title/image key is actually present).
//
// Remove once TI-42 and BUG-31 are root-caused (mirror commit 9699309 "remove temporary test-env
// diagnostics").
public static class E2EApiTrace
{
    private static readonly string[] TracedFragments =
    [
        "/notes/cards",      // TI-42: the cards list read
        "/content",          // BUG-31: the persisted note content (does it still carry the image key?)
        "/images/resolve",   // BUG-31: key -> presigned URL resolution
    ];

    public static void Attach(IPage page)
    {
        page.Response += (_, response) =>
        {
            if (!TracedFragments.Any(f => response.Url.Contains(f, StringComparison.OrdinalIgnoreCase)))
                return;

            // Capture all synchronous fields immediately — the response object is only safe to read
            // before the context is disposed; the body read is awaited best-effort below.
            var method = response.Request.Method;
            var url = response.Url;
            var status = response.Status;
            var reqToken = response.Request.Headers.TryGetValue("x-consistency-token", out var t) ? t : "-";
            var freshness = response.Headers.TryGetValue("x-consistency", out var f) ? f : "fresh";

            _ = PrintAsync(response, method, url, status, reqToken, freshness);
        };
    }

    private static async Task PrintAsync(
        IResponse response, string method, string url, int status, string reqToken, string freshness)
    {
        string body;
        try
        {
            body = await response.TextAsync().ConfigureAwait(false);
        }
        catch
        {
            // The context/page can be torn down before a late body read resolves ("Target closed").
            // This is a diagnostic; swallow and report what we already have synchronously.
            body = "<body-unavailable>";
        }

        if (body.Length > 600)
            body = body[..600] + "…";
        body = body.ReplaceLineEndings(" ");

        Console.WriteLine(
            $"[api-trace] {method} {status} req-token={reqToken} resp-consistency={freshness} {url} :: {body}");
    }
}
