namespace Domain.Notes;

public static class TagNormalization
{
    // Tags are case-insensitive (CHANGE-17): the single canonical form everywhere —
    // aggregate, projections, and read paths — is trimmed lowercase. ToLowerInvariant
    // (not ToLower) keeps the key culture-independent across the Lambda locale and clients.
    public static string Normalize(string tag) => tag.Trim().ToLowerInvariant();
}
