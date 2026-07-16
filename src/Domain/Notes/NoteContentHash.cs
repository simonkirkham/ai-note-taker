using System.Security.Cryptography;
using System.Text;

namespace Domain.Notes;

// BUG-47: the content optimistic-concurrency fingerprint. Lower-hex SHA-256 of the UTF-8 bytes of the
// content (null treated as ""). Pure and deterministic so the aggregate can compare its current
// content against the base the caller loaded. The web client computes the same hash the same way
// (Web Crypto SHA-256 over UTF-8), so a matching base proves the caller edited the content it saw.
public static class NoteContentHash
{
    public static string Compute(string? content)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(content ?? string.Empty));
        return Convert.ToHexStringLower(bytes);
    }
}
