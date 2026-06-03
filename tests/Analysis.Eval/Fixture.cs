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
    IReadOnlyList<string> ContentMustMention);

public static class FixtureLoader
{
    static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter() }
    };

    public static IReadOnlyList<Fixture> LoadAll(string directory)
    {
        throw new NotImplementedException("Pip: load every *.json under directory and deserialize to Fixture.");
    }
}
