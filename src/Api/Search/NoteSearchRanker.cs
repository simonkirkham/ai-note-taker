using System.Text.RegularExpressions;
using EventStore.Projections;
using FuzzySharp;

namespace Api.Search;

public sealed record NoteSearchResult(
    NoteSearchView View,
    double Score,
    string MatchedField,
    string Snippet,
    IReadOnlyList<string> MatchedTerms);

public static partial class NoteSearchRanker
{
    private const double TitleWeight = 1.5;
    private const double ScoreThreshold = 60;
    private const int TokenMatchThreshold = 70;
    private const int MaxTerms = 3;
    private const int MinTokenLength = 3;
    private const int MaxResults = 50;
    private const int SnippetLength = 120;

    public static IReadOnlyList<NoteSearchResult> Rank(string query, IReadOnlyList<NoteSearchView> notes)
    {
        var trimmed = query.Trim();
        var ranked = new List<NoteSearchResult>();
        foreach (var note in notes)
        {
            var best = BestField(trimmed, note);
            if (best.Score >= ScoreThreshold)
                ranked.Add(best);
        }

        return ranked
            .OrderByDescending(r => r.Score)
            .Take(MaxResults)
            .ToList()
            .AsReadOnly();
    }

    private static NoteSearchResult BestField(string query, NoteSearchView note)
    {
        var title = Score(query, note.Title) * TitleWeight;
        var body = Score(query, note.Body);
        var finalNotes = Score(query, note.FinalNotesText);
        var actions = Score(query, note.ActionItemsText);
        var tags = note.Tags.Count == 0 ? 0 : note.Tags.Max(t => Score(query, t));

        var candidates = new (double Score, string Field, string Source)[]
        {
            (title, "title", note.Title),
            (tags, "tag", string.Join(" ", note.Tags)),
            (body, "notes", note.Body),
            (finalNotes, "notes", note.FinalNotesText),
            (actions, "notes", note.ActionItemsText)
        };

        var winner = candidates.OrderByDescending(c => c.Score).First();
        var matchedTerms = winner.Field == "tag"
            ? MatchedTags(query, note.Tags)
            : MatchedTokens(query, winner.Source);
        var snippet = BuildSnippet(query, note, matchedTerms);
        return new NoteSearchResult(note, winner.Score, winner.Field, snippet, matchedTerms);
    }

    private static double Score(string query, string text)
    {
        if (string.IsNullOrWhiteSpace(text)) return 0;
        return Math.Max(Fuzz.PartialRatio(query, text), Fuzz.TokenSetRatio(query, text));
    }

    private static IReadOnlyList<string> MatchedTokens(string query, string fieldText)
    {
        if (string.IsNullOrWhiteSpace(fieldText)) return [];

        var tokens = TokenPattern().Split(fieldText)
            .Where(t => t.Length >= MinTokenLength)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (tokens.Count == 0) return [];

        return Process.ExtractTop(query, tokens, limit: MaxTerms)
            .Where(r => r.Score >= TokenMatchThreshold)
            .Select(r => r.Value)
            .ToList()
            .AsReadOnly();
    }

    private static IReadOnlyList<string> MatchedTags(string query, IReadOnlyList<string> tags)
    {
        if (tags.Count == 0) return [];

        return Process.ExtractTop(query, tags, limit: MaxTerms)
            .Where(r => r.Score >= TokenMatchThreshold)
            .Select(r => r.Value)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList()
            .AsReadOnly();
    }

    private static string BuildSnippet(string query, NoteSearchView note, IReadOnlyList<string> matchedTerms)
    {
        var source = !string.IsNullOrWhiteSpace(note.Body) ? note.Body
            : !string.IsNullOrWhiteSpace(note.FinalNotesText) ? note.FinalNotesText
            : note.Title;
        if (string.IsNullOrEmpty(source)) return string.Empty;

        var idx = -1;
        foreach (var term in matchedTerms)
        {
            idx = source.IndexOf(term, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0) break;
        }
        if (idx < 0)
            idx = source.IndexOf(query, StringComparison.OrdinalIgnoreCase);
        if (idx < 0)
            return source.Length <= SnippetLength ? source : source[..SnippetLength];

        var start = Math.Max(0, idx - SnippetLength / 4);
        var length = Math.Min(SnippetLength, source.Length - start);
        var snippet = source.Substring(start, length);
        return start > 0 ? "…" + snippet : snippet;
    }

    [GeneratedRegex(@"[^\p{L}\p{N}]+")]
    private static partial Regex TokenPattern();
}
