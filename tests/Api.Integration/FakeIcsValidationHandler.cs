using System.Net;
using System.Text;

namespace Api.Integration;

// 34-E: stubs the connect/ics endpoint's one-time validation fetch so integration tests never hit
// the network. A request URL whose path contains "bad-feed" returns a non-ICS body (→ invalid_feed);
// any other allowed URL returns a minimal valid ICS (→ connected). The SSRF guard runs unstubbed
// before this handler is ever reached, so test feed URLs must use a public host.
internal sealed class FakeIcsValidationHandler : HttpMessageHandler
{
    private const string ValidIcs =
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n" +
        "BEGIN:VEVENT\r\nUID:probe\r\nDTSTART:20260101T090000Z\r\nDTEND:20260101T093000Z\r\nSUMMARY:Probe\r\nEND:VEVENT\r\n" +
        "END:VCALENDAR";

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var path = request.RequestUri?.AbsolutePath ?? "";
        var body = path.Contains("bad-feed", StringComparison.OrdinalIgnoreCase)
            ? "this is not a calendar"
            : ValidIcs;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "text/calendar")
        });
    }
}
