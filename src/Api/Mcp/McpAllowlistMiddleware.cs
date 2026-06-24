using System.Net;
using System.Net.Sockets;

namespace Api.Mcp;

// 35-A defence-in-depth: restrict the no-auth MCP endpoint to a CIDR allowlist read from
// MCP_ALLOWED_CIDRS (comma-separated). Empty/unset = allow all (no-op until ops populates the
// Anthropic IP ranges). Only the /w/{wsId}/mcp path is gated.
public sealed class McpAllowlistMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (IsMcpPath(context.Request.Path) && !IsAllowed(context.Connection.RemoteIpAddress))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }

    private static bool IsMcpPath(PathString path) =>
        path.StartsWithSegments("/w", out var rest) && rest.Value?.EndsWith("/mcp", StringComparison.Ordinal) == true;

    private static bool IsAllowed(IPAddress? remoteIp)
    {
        var ranges = (Environment.GetEnvironmentVariable("MCP_ALLOWED_CIDRS") ?? "")
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (ranges.Length == 0)
            return true;
        if (remoteIp is null)
            return false;

        return ranges.Any(cidr => InCidr(remoteIp, cidr));
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
