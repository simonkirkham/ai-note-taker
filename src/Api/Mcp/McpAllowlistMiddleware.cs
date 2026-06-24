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
        if (IsMcpPath(context.Request.Path) && !IsAllowed(ClientIp(context), config["MCP_ALLOWED_CIDRS"]))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }

        await next(context);
    }

    private static bool IsMcpPath(PathString path) =>
        path.StartsWithSegments("/w", out var rest) && rest.Value?.EndsWith("/mcp", StringComparison.Ordinal) == true;

    // Behind API Gateway/CloudFront the connection IP is the proxy, not the caller; the real
    // client is the left-most X-Forwarded-For hop. Fall back to the connection IP locally.
    private static IPAddress? ClientIp(HttpContext context)
    {
        var forwarded = context.Request.Headers["X-Forwarded-For"].ToString();
        var first = forwarded.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
        return first is not null && IPAddress.TryParse(first, out var parsed)
            ? parsed
            : context.Connection.RemoteIpAddress;
    }

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
