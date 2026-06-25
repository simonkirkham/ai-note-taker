using System.Net;
using System.Net.Sockets;

namespace Api.Services;

// SSRF guard for the ICS feed URL (34-E). The feed URL is user-supplied and then fetched
// server-side, so it is a server-side-request-forgery vector: a malicious URL could point at the
// loopback interface, the VPC's private ranges, or the EC2/ECS metadata endpoint (169.254.169.254)
// to read credentials. IsAllowed enforces: absolute https only, host resolvable, and EVERY resolved
// address public (no loopback / RFC1918 private / link-local / unique-local / metadata).
//
// Applied at BOTH connect time AND before every fetch in IcsFeedCalendarClient — defense in depth
// against DNS rebinding (a host that resolved public at connect time can later resolve to a private
// address). DNS resolution happens once here; the same host is re-resolved per fetch by re-calling.
public static class IcsUrlValidator
{
    public static bool IsAllowed(string? url)
    {
        if (string.IsNullOrWhiteSpace(url))
            return false;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri))
            return false;
        // https only — http is plaintext and also a downgrade vector.
        if (uri.Scheme != Uri.UriSchemeHttps)
            return false;

        IPAddress[] addresses;
        try
        {
            // A literal IP host resolves to itself; a DNS name is looked up. An unresolvable host
            // throws → rejected.
            addresses = Dns.GetHostAddresses(uri.DnsSafeHost);
        }
        catch (Exception)
        {
            return false;
        }

        if (addresses.Length == 0)
            return false;

        // Reject if ANY resolved address is non-public — a single private answer is enough to abuse
        // (and a rebinding host may return a mix).
        return addresses.All(IsPublic);
    }

    private static bool IsPublic(IPAddress address)
    {
        var ip = address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;

        if (IPAddress.IsLoopback(ip))
            return false;

        if (ip.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = ip.GetAddressBytes();
            // 10.0.0.0/8
            if (b[0] == 10) return false;
            // 172.16.0.0/12
            if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return false;
            // 192.168.0.0/16
            if (b[0] == 192 && b[1] == 168) return false;
            // 169.254.0.0/16 link-local (covers the 169.254.169.254 metadata endpoint)
            if (b[0] == 169 && b[1] == 254) return false;
            // 100.64.0.0/10 carrier-grade NAT (shared address space)
            if (b[0] == 100 && b[1] >= 64 && b[1] <= 127) return false;
            // 0.0.0.0/8 "this host"
            if (b[0] == 0) return false;
            return true;
        }

        if (ip.AddressFamily == AddressFamily.InterNetworkV6)
        {
            if (ip.IsIPv6LinkLocal) return false; // fe80::/10
            if (ip.IsIPv6SiteLocal) return false;
            var b = ip.GetAddressBytes();
            // fc00::/7 unique-local
            if ((b[0] & 0xFE) == 0xFC) return false;
            return true;
        }

        // Unknown address family — refuse.
        return false;
    }
}
