using System.Text;
using System.Text.Json;

namespace Api.Integration;

// Builds an unsigned (test) Google-shaped JWT id_token carrying a `sub` claim. The
// /auth/token handler decodes `sub` from the payload WITHOUT signature validation (the
// token came directly from Google's token endpoint over TLS), so a fake signature is fine.
public static class TestJwt
{
    public static string WithSub(string sub)
    {
        var header = Base64Url("""{"alg":"RS256","typ":"JWT"}"""u8.ToArray());
        var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { sub }));
        const string signature = "fake-signature";
        return $"{header}.{payload}.{signature}";
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
