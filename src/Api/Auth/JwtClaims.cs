using System.Text.Json;

namespace Api.Auth;

// Reads a claim from a JWT payload WITHOUT signature validation. Safe only for tokens fetched
// directly from the provider's token endpoint over TLS (e.g. an id_token from a code exchange) or
// already validated by the bearer middleware. Any malformed input yields null; never throws.
public static class JwtClaims
{
    public static string? TryGetClaim(string? jwt, string claim)
    {
        if (string.IsNullOrEmpty(jwt))
            return null;

        var firstDot = jwt.IndexOf('.');
        if (firstDot < 0) return null;
        var secondDot = jwt.IndexOf('.', firstDot + 1);
        if (secondDot < 0) return null;

        var bytes = DecodeBase64Url(jwt.AsSpan(firstDot + 1, secondDot - firstDot - 1));
        if (bytes is null) return null;

        try
        {
            using var doc = JsonDocument.Parse(bytes);
            return doc.RootElement.TryGetProperty(claim, out var el) && el.ValueKind == JsonValueKind.String
                ? el.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static byte[]? DecodeBase64Url(ReadOnlySpan<char> value)
    {
        var normalized = new string(value.ToArray()).Replace('-', '+').Replace('_', '/');
        switch (normalized.Length % 4)
        {
            case 2: normalized += "=="; break;
            case 3: normalized += "="; break;
            case 1: return null;
        }
        try
        {
            return Convert.FromBase64String(normalized);
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
