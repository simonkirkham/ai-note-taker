using System.Text.Json;
using System.Text.Json.Serialization;

namespace Analysis.Eval;

public sealed record Fixture(
    string Id,
    string TranscriptText,
    string ExistingContent,
    string CurrentUserName,
    FixtureExpected Expected);

public sealed record FixtureExpected(
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> ActionItems,
    IReadOnlyList<string> ContentMustMention,
    // MPI-10: the user's OWN note for this meeting, verbatim — the STYLE gold. When present,
    // the quality judge scores a `style` dimension: does the generated note read like the
    // user's own (dense subject-first facts, headers/bullets, named attribution, the user's
    // spelling)? Null/empty on the synthetic Fixtures/ corpus (no real user note) — the style
    // dimension is then omitted. Only the real, git-ignored corpus carries a gold note.
    string? GoldNote = null);

public static class FixtureLoader
{
    static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public static IReadOnlyList<Fixture> LoadAll(string directory)
    {
        return Directory.EnumerateFiles(directory, "*.json")
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path =>
                JsonSerializer.Deserialize<Fixture>(File.ReadAllText(path), Options)
                ?? throw new InvalidDataException($"Fixture {path} deserialized to null"))
            .ToList();
    }
}
