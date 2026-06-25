using Api.Services;

namespace Api.Integration;

// SSRF guard tests (34-E). Literal IP hosts resolve to themselves, so these are deterministic and
// network-independent: a public literal (8.8.8.8) is accepted; loopback/private/link-local are
// rejected, as are non-https and non-absolute URLs.
public sealed class IcsUrlValidatorTests
{
    [Theory]
    [InlineData("https://8.8.8.8/cal.ics")] // public literal — resolves to itself
    public void Accepts_PublicHttpsUrl(string url) => Assert.True(IcsUrlValidator.IsAllowed(url));

    [Theory]
    [InlineData("http://8.8.8.8/cal.ics")]            // not https
    [InlineData("ftp://8.8.8.8/cal.ics")]            // not https
    [InlineData("https://127.0.0.1/cal.ics")]        // loopback
    [InlineData("https://localhost/cal.ics")]        // loopback by name
    [InlineData("https://10.0.0.5/cal.ics")]         // RFC1918 10/8
    [InlineData("https://192.168.1.10/cal.ics")]     // RFC1918 192.168/16
    [InlineData("https://172.16.5.5/cal.ics")]       // RFC1918 172.16/12
    [InlineData("https://169.254.169.254/latest/meta-data/")] // cloud metadata
    [InlineData("https://[::1]/cal.ics")]            // IPv6 loopback
    [InlineData("/relative/path.ics")]               // not absolute
    [InlineData("not a url")]                         // unparseable
    [InlineData("")]                                  // empty
    [InlineData(null)]                                // null
    public void Rejects_DisallowedUrl(string? url) => Assert.False(IcsUrlValidator.IsAllowed(url));
}
