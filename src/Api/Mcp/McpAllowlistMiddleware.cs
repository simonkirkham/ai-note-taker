using System.Net;

namespace Api.Mcp;

// 35-A defence-in-depth: restrict the no-auth MCP endpoint to a CIDR allowlist read from
// MCP_ALLOWED_CIDRS (via IConfiguration, so the Lambda env var flows in prod but tests can
// override without mutating process-global state). Empty/unset = allow all (no-op until ops
// populates the Anthropic IP ranges). Only the /w/{wsId}/mcp path is gated.
public sealed class McpAllowlistMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IConfiguration config)
    {
        // RemoteIpAddress is the AWS-computed sourceIp: Amazon.Lambda.AspNetCoreServer sets it from
        // requestContext.http.sourceIp, the real TCP peer for this regional API Gateway endpoint. It
        // is NOT spoofable via X-Forwarded-For (API Gateway appends the peer rather than trusting the
        // client's XFF), so do not read XFF here — that would be attacker-controlled.
        if (IsMcpPath(context.Request.Path) && !IsAllowed(context.Connection.RemoteIpAddress, config["MCP_ALLOWED_CIDRS"]))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }

    private static bool IsMcpPath(PathString path) =>
        path.StartsWithSegments("/w", out var rest) && rest.Value?.EndsWith("/mcp", StringComparison.Ordinal) == true;

    private static bool IsAllowed(IPAddress? clientIp, string? configuredCidrs)
    {
        var ranges = (configuredCidrs ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (ranges.Length == 0)
            return true;
        if (clientIp is null)
            return false;

        return ranges.Any(cidr => InCidr(clientIp, cidr));
    }

    private static bool InCidr(IPAddress address, string cidr)
    {
        var parts = cidr.Split('/');
        if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var network) || !int.TryParse(parts[1], out var prefixLength))
            return false;
        if (network.AddressFamily != address.AddressFamily)
            return false;

        var addressBytes = address.GetAddressBytes();
        var networkBytes = network.GetAddressBytes();
        if (addressBytes.Length != networkBytes.Length)
            return false;

        var fullBytes = prefixLength / 8;
        for (var i = 0; i < fullBytes; i++)
        {
            if (addressBytes[i] != networkBytes[i])
                return false;
        }

        var remainingBits = prefixLength % 8;
        if (remainingBits == 0)
            return true;

        var mask = (byte)(0xFF << (8 - remainingBits));
        return (addressBytes[fullBytes] & mask) == (networkBytes[fullBytes] & mask);
    }
}
