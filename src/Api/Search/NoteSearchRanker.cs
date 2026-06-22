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
    private const double ScoreThreshold = 70;
    private const int MaxTerms = 3;
    private const int MaxResults = 50;
    private const int SnippetLength = 120;

    // Token-level match tuning. Search is word-based, not substring-based: a query
    // term matches a document token only by whole-word equality, prefix, or a tight
    // whole-token fuzzy ratio — never by a shared substring (which made "Andrew"
    // match the word "and").
    private const int PrefixMinTermLength = 3;   // "Andrew" → "Andrews"; too short to prefix-match below this
    private const int FuzzyMinTermLength = 4;    // only fuzzy-match terms long enough to be typo-bearing
    private const double PrefixScore = 92;
    private const double FuzzyTokenFloor = 85;   // "planing" vs "planning" ≈ 93; "and" vs "andrew" ≈ 67 (rejected)

    public static IReadOnlyList<NoteSearchResult> Rank(string query, IReadOnlyList<NoteSearchView> notes)
    {
        var trimmed = query.Trim();
        var terms = Tokenize(trimmed);
        var ranked = new List<NoteSearchResult>();
        foreach (var note in notes)
        {
            var best = BestField(trimmed, terms, note);
            // Gate on the strongest single-term hit, not the mean: a multi-word query
            // surfaces a note that matches ANY term strongly (OR semantics); the mean
            // only ranks full-coverage matches higher. Gating on the mean would silently
            // require every term (AND) and drop "budget review" notes that only say "budget".
            if (best.Gate >= ScoreThreshold)
                ranked.Add(best.Result);
        }

        return ranked
            .OrderByDescending(r => r.Score)
            .Take(MaxResults)
            .ToList()
            .AsReadOnly();
    }

    private static (NoteSearchResult Result, double Gate) BestField(
        string query, IReadOnlyList<string> terms, NoteSearchView note)
    {
        var title = Score(terms, note.Title);
        var body = Score(terms, note.Body);
        var finalNotes = Score(terms, note.FinalNotesText);
        var actions = Score(terms, note.ActionItemsText);
        // Each tag scored independently: rank on the best tag's mean, but gate on the
        // strongest single-term hit across ALL tags (a different tag may carry it).
        var tagScores = note.Tags.Select(t => Score(terms, t)).ToList();
        var tagMean = tagScores.Count == 0 ? 0 : tagScores.Max(s => s.Mean);
        var tagGate = tagScores.Count == 0 ? 0 : tagScores.Max(s => s.MaxTerm);

        var candidates = new (double Score, double MaxTerm, string Field, string Source)[]
        {
            (title.Mean * TitleWeight, title.MaxTerm, "title", note.Title),
            (tagMean, tagGate, "tag", string.Join(" ", note.Tags)),
            (body.Mean, body.MaxTerm, "notes", note.Body),
            (finalNotes.Mean, finalNotes.MaxTerm, "notes", note.FinalNotesText),
            (actions.Mean, actions.MaxTerm, "notes", note.ActionItemsText)
        };

        var winner = candidates.OrderByDescending(c => c.Score).First();
        var gate = candidates.Max(c => c.MaxTerm);
        var matchedTerms = winner.Field == "tag"
            ? MatchedTags(query, note.Tags)
            : MatchedTokens(query, winner.Source);
        var snippet = BuildSnippet(query, note, matchedTerms);
        return (new NoteSearchResult(note, winner.Score, winner.Field, snippet, matchedTerms), gate);
    }

    // Per-field word-level score. Whole-text fuzzy ratios (PartialRatio/TokenSetRatio)
    // are deliberately not used — they match on any shared substring window, so a
    // 6-char query found "and…" windows in long bodies and scored above threshold
    // against unrelated notes. Returns the mean per-term score (for ranking — rewards
    // full-coverage matches) and the best single-term score (for the inclusion gate).
    private static (double Mean, double MaxTerm) Score(IReadOnlyList<string> terms, string text)
    {
        if (terms.Count == 0 || string.IsNullOrWhiteSpace(text)) return (0, 0);
        var tokens = Tokenize(text);
        if (tokens.Count == 0) return (0, 0);

        double total = 0, max = 0;
        foreach (var term in terms)
        {
            var s = BestTokenScore(term, tokens);
            total += s;
            if (s > max) max = s;
        }
        return (total / terms.Count, max);
    }

    private static double BestTokenScore(string term, IReadOnlyList<string> tokens)
    {
        var lowerTerm = term.ToLowerInvariant();
        double best = 0;
        foreach (var token in tokens)
        {
            var score = TermTokenScore(term, lowerTerm, token);
            if (score > best) best = score;
            if (best >= 100) break;
        }
        return best;
    }

    // The single definition of "query term matches document token", shared by the
    // inclusion gate (BestTokenScore) and the highlight/snippet path (TopMatches) so
    // the term shown to the user is always one that could have qualified the note.
    private static double TermTokenScore(string term, string lowerTerm, string token)
    {
        if (string.Equals(token, term, StringComparison.OrdinalIgnoreCase))
            return 100;
        if (term.Length >= PrefixMinTermLength && token.Length > term.Length
            && token.StartsWith(term, StringComparison.OrdinalIgnoreCase))
            return PrefixScore;
        if (term.Length >= FuzzyMinTermLength)
        {
            var ratio = Fuzz.Ratio(lowerTerm, token.ToLowerInvariant());
            return ratio >= FuzzyTokenFloor ? ratio : 0;
        }
        return 0;
    }

    private static List<string> Tokenize(string text) =>
        string.IsNullOrWhiteSpace(text)
            ? []
            : TokenPattern().Split(text).Where(t => t.Length > 0).ToList();

    private static IReadOnlyList<string> MatchedTokens(string query, string fieldText) =>
        TopMatches(query, Tokenize(fieldText));

    private static IReadOnlyList<string> MatchedTags(string query, IReadOnlyList<string> tags) =>
        TopMatches(query, tags);

    // Highest-scoring candidates by the same word-level matcher the gate uses. Each
    // candidate (a field token, or a whole tag) is scored against every query term;
    // those clearing the gate floor are returned, strongest first.
    private static IReadOnlyList<string> TopMatches(string query, IReadOnlyList<string> candidates)
    {
        if (candidates.Count == 0) return [];
        var terms = Tokenize(query);
        if (terms.Count == 0) return [];
        var lowerTerms = terms.Select(t => t.ToLowerInvariant()).ToArray();

        return candidates
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(c => (Value: c, Score: BestTermScore(terms, lowerTerms, c)))
            .Where(x => x.Score >= ScoreThreshold)
            .OrderByDescending(x => x.Score)
            .Take(MaxTerms)
            .Select(x => x.Value)
            .ToList()
            .AsReadOnly();
    }

    private static double BestTermScore(IReadOnlyList<string> terms, string[] lowerTerms, string candidate)
    {
        double best = 0;
        for (var i = 0; i < terms.Count; i++)
        {
            var score = TermTokenScore(terms[i], lowerTerms[i], candidate);
            if (score > best) best = score;
            if (best >= 100) break;
        }
        return best;
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
