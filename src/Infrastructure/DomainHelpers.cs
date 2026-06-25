public static class DomainHelpers
{
    // "test.note-taker-ai.com" -> "note-taker-ai.com"
    // "note-taker-ai.com"      -> "note-taker-ai.com"
    public static string ApexDomain(string domain)
    {
        var parts = domain.Split('.');
        return parts.Length > 2 ? string.Join('.', parts[^2..]) : domain;
    }
}
