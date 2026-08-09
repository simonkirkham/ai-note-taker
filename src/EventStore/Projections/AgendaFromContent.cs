using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Domain.Notes;

namespace EventStore.Projections;

// Phase 43-F — the agenda is a READING of the note body: every task-list line in the markdown is a
// topic, and the tick is the `[x]` in that line. Parsing lives here rather than in the projection
// so both the live projector and ProjectionRebuildHandler share one definition of "what counts as
// a topic" (they already share NoteDetailProjection.Handle).
public static partial class AgendaFromContent
{
    // GFM task list item: any bullet marker, optional indent (nested items count — a topic is a
    // topic), `[ ]` or `[x]`, then the text. Applied per line so fenced code can be skipped.
    // A `>`-prefixed (blockquoted) line is deliberately NOT a topic: a blockquote in a meeting note
    // is usually quoted material — someone else's checklist — and counting it as your agenda is
    // worse than skipping it. Tiptap still renders it as a clickable checkbox, so ticking one moves
    // nothing; recorded under phase-43.md "Open decisions".
    [GeneratedRegex(@"^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(.+?)[ \t]*$", RegexOptions.None,
        matchTimeoutMilliseconds: 1000)]
    private static partial Regex TaskLine();

    // An opening or closing code fence: three or more backticks or tildes. prosemirror-markdown's
    // codeBlock serializer ALWAYS fences, so a pasted runbook reaches us this way through the
    // ordinary editor — its `- [ ]` lines are code, not topics.
    [GeneratedRegex(@"^[ \t]*(`{3,}|~{3,})", RegexOptions.None, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Fence();

    // prosemirror-markdown's inline esc() backslash-escapes ` * \ ~ [ ] _ in text, so the raw
    // source of a line the user typed as "Review Q3 [draft]" is "Review Q3 \[draft\]". Topic text
    // is user-visible, and 43-H matches migrated text against body lines, so unescape on the way in.
    [GeneratedRegex(@"\\([\p{P}\p{S}])", RegexOptions.None, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Escaped();

    /// <summary>Topics read out of the note body, in document order.</summary>
    public static List<AgendaItemView> Parse(NoteId noteId, string? content)
    {
        var items = new List<AgendaItemView>();
        if (string.IsNullOrWhiteSpace(content)) return items;

        // How many times each distinct topic text has been seen. Two lines with identical text are
        // distinct topics, so the ordinal joins the hash — otherwise both derive the same id and
        // the UI reconciles them by key, swapping their ticked state (Hawk, PR #428).
        var seen = new Dictionary<string, int>();
        var position = 0;
        string? openFence = null;

        foreach (var raw in content.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            var fence = Fence().Match(line);

            if (openFence is not null)
            {
                // Inside a fence: only a closing fence of the same character and at least the same
                // length ends it. Everything else — task lines included — is code.
                if (fence.Success && fence.Groups[1].Value[0] == openFence[0]
                    && fence.Groups[1].Value.Length >= openFence.Length)
                    openFence = null;
                continue;
            }

            if (fence.Success)
            {
                openFence = fence.Groups[1].Value;
                continue;
            }

            var m = TaskLine().Match(line);
            if (!m.Success) continue;

            // CHANGE-38: a topic is the text the user SEES, not the markdown that produces it. A line
            // typed as `**Budget**` renders bold in the note but read raw it says `**Budget**` in the
            // note card and anywhere else the server-derived agenda is shown. Stripping HERE rather
            // than at each display site keeps one definition, and makes the id, the ordinal and the
            // match key all agree — two topics are the same iff they read the same.
            //
            // Safe because nothing writes this text back into a body: header edits go through the
            // editor's own doc (agendaEditorApi reads ProseMirror textContent, already marker-free),
            // and 43-H1's migration writes LEGACY event text, never this.
            // Strip BEFORE unescaping. prosemirror-markdown writes literal asterisks the user typed
            // as `\*Budget\*`; unescaping first hands the emphasis passes a live `*Budget*` and
            // deletes the very characters the note displays — the inverse of what this is for.
            var text = Unescape(StripInlineMarks(m.Groups[2].Value.Trim()));
            if (text.Length == 0) continue;

            var key = Key(text);
            var ordinal = seen.TryGetValue(key, out var n) ? n : 0;
            seen[key] = ordinal + 1;

            items.Add(new AgendaItemView(
                DeriveId(noteId, key, ordinal), text, m.Groups[1].Value is "x" or "X", position++,
                Derived: true));
        }
        return items;
    }

    /// <summary>
    /// The union folded into <see cref="NoteDetailView.Agenda"/> during the 43-F/43-H strangler
    /// window: topics read from the body, then any legacy <c>AgendaItem*</c> topic that has no
    /// matching body line. A matched pair is listed ONCE and the BODY wins — not just because it is
    /// the surface the user just edited, but because legacy-wins would make a migrated topic
    /// permanently un-untickable: 43-H writes `- [x] Foo` into the body, and a later untick there
    /// would be overridden forever by the old AgendaItemDiscussedSet(true).
    /// </summary>
    public static IReadOnlyList<AgendaItemView> Compose(
        NoteId noteId, string? content, IReadOnlyList<AgendaItemView> legacy)
    {
        var fromBody = Parse(noteId, content);
        if (legacy.Count == 0) return fromBody.AsReadOnly();

        // A COUNT per body key, not a set: N body lines absorb N legacy items, no more. With a set,
        // two legacy items sharing a key were both dropped for a single matching body line — the
        // "silently skipped, then deleted for good by 43-H2" shape, since a skipped item is never
        // migrated and nothing left in the view would show it was lost.
        //
        // Body items are keyed WITHOUT re-stripping. Since CHANGE-38, Parse already returns stripped
        // display text, and StripInlineMarks is NOT idempotent — `` `**x**` `` legitimately outputs
        // the literal `**x**`, which a second pass would then strip to `x`. Running MatchKey over
        // already-parsed text therefore moved the dedup in BOTH bad directions: a body line
        // ``**`deploy.yml`**`` stopped matching its legacy twin (double-listed, and the migration
        // re-injected it on every run), while `` `**x**` `` started matching a genuinely different
        // legacy topic `x` (silently skipped, then deleted for good by 43-H2). Legacy text comes
        // from events and has never been stripped, so it still needs the full MatchKey.
        var bodyText = fromBody.GroupBy(i => CollapseKey(i.Text))
            .ToDictionary(g => g.Key, g => g.Count());
        var position = fromBody.Count;
        foreach (var item in legacy)
        {
            var key = MatchKey(item.Text);
            if (bodyText.TryGetValue(key, out var remaining) && remaining > 0)
            {
                bodyText[key] = remaining - 1;
                continue;
            }
            fromBody.Add(item with { Position = position++ });
        }
        return fromBody.AsReadOnly();
    }

    /// <summary>
    /// The one definition of "these two are the same topic", used by the 43-F/H union above — and
    /// therefore by the 43-H1 migration, which writes exactly the topics <see cref="Compose"/> left
    /// unmatched. A second, divergent normaliser is how a topic gets silently skipped and then
    /// deleted for good by 43-H2, so there is only this one.
    ///
    /// Unescapes (the editor re-serialises text with backslash escapes on the user's next save, so a
    /// literal comparison would miss an already-migrated topic and duplicate it) and strips paired
    /// inline markers via <see cref="StripInlineMarks"/>, so a body line `- [ ] **Budget**` matches
    /// the legacy item `Budget`. Only PAIRED delimiters go: a looser rule risks the opposite, worse
    /// error of matching two topics that genuinely differ — which 43-H2 would then delete for good.
    ///
    /// Internal whitespace collapses to a single space because a legacy topic may hold a newline
    /// (AddAgendaItem only trimmed) and the migration must flatten it to write one task line — so
    /// the two must compare equal, or every re-run would list the topic again.
    /// </summary>
    ///
    /// Strips BEFORE unescaping, and the emphasis patterns refuse a backslash-escaped opening run.
    /// prosemirror-markdown writes literal asterisks the user typed as `\*Budget\*`; unescaping
    /// first would hand the emphasis passes a live `*Budget*` and delete the very characters the
    /// note displays — the exact inverse of what CHANGE-38 is for.
    public static string MatchKey(string text) => CollapseKey(Unescape(StripInlineMarks(text)));

    /// <summary>Whitespace/case normalisation only — for text that is ALREADY stripped.</summary>
    private static string CollapseKey(string text) =>
        Whitespace().Replace(text, " ").Trim().ToLowerInvariant();

    /// <summary>
    /// Drops paired inline markdown delimiters and keeps what they wrapped: `**Budget**` → `Budget`.
    /// The three passes are ordered — code spans first, so their contents are never re-read as
    /// emphasis.
    ///
    /// `*` and `_` are deliberately NOT one pattern. CommonMark lets `*` open intraword but not `_`,
    /// so a single rule either mangles `snake_case_name` (stripping the middle run) or misses
    /// `a**b**c`. The `\S` lookarounds are what stop `2 * 3` and `a _ b` pairing across whitespace —
    /// a delimiter run followed by a space opens nothing.
    /// </summary>
    /// <summary>Drops the private-use characters used to mask code spans. Public so the 43-H1
    /// migration can filter a legacy topic made only of them, which would otherwise be written
    /// out and read back empty, and re-appended on every run.</summary>
    public static string StripMaskCharacters(string text) => Sentinel().Replace(text, "");

    public static string StripInlineMarks(string text)
    {
        // A pathological line (thousands of backticks) makes CodeSpan's backreference quadratic and
        // would throw RegexMatchTimeoutException straight out of the projection fold, DLQ-ing the
        // record and stalling that note. No real topic is this long; bail rather than risk it.
        if (text.Length > 2000) return text;

        // Each code span is swapped for a delimiter-free sentinel BEFORE the emphasis passes, then
        // restored. Two properties fall out that a straight walk does not give:
        //   * emphasis WRAPPING a code span is still emphasis — ``**`deploy.yml`**`` renders as bold
        //     code, so the topic reads `deploy.yml`, not `**deploy.yml**`;
        //   * a code span's CONTENTS never reach the emphasis passes, so `` `**x**` `` stays the
        //     literal `**x**` — it is code, not bold.
        // The sentinel is a private-use character: it carries no markdown meaning, so it can neither
        // open nor close a delimiter run. It is not, however, IMPOSSIBLE in note text — a paste can
        // carry anything — so any pre-existing occurrence is dropped first. Otherwise a pasted
        // \uE000 12 \uE001 would be restored as span 12, and on a note with fewer spans that is an
        // IndexOutOfRangeException thrown straight out of the projection fold, DLQ-ing the record.
        // The restore is bounds-checked as well: a malformed placeholder leaves the text as-is
        // rather than throwing.
        var spans = new List<string>();
        var masked = CodeSpan().Replace(StripMaskCharacters(text), m =>
        {
            spans.Add(m.Groups[2].Value);
            return $"{spans.Count - 1}";
        });

        var stripped = UnderscoreEmphasis().Replace(StarEmphasis().Replace(masked, "$2"), "$2");

        return Sentinel().Replace(stripped, m =>
            int.TryParse(m.Groups[1].Value, NumberStyles.None, CultureInfo.InvariantCulture, out var i)
            && i < spans.Count
                ? spans[i]
                : m.Value);
    }

    private static string Unescape(string text) => Escaped().Replace(text, "$1");

    // The backreference is what makes each of these PAIRED — the closing run must match the opening.
    [GeneratedRegex(@"(`+)([^`]+?)\1", RegexOptions.None, matchTimeoutMilliseconds: 1000)]
    private static partial Regex CodeSpan();

    // Matches the private-use placeholder StripInlineMarks swaps each code span for.
    [GeneratedRegex("\uE000([0-9]+)\uE001", RegexOptions.None, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Sentinel();

    [GeneratedRegex(@"(?<!\\)(\*{1,3}|~{2})(?=\S)(.+?)(?<=\S)\1", RegexOptions.None,
        matchTimeoutMilliseconds: 1000)]
    private static partial Regex StarEmphasis();

    // `(?<!\w)` / `(?!\w)`: intraword underscores are literal, so `snake_case_name` survives whole.
    // `\\` in the lookbehind: a backslash-escaped run is a LITERAL delimiter the note displays.
    // KNOWN LIMIT: that lookbehind is one character, so it also blocks emphasis after an ESCAPED
    // backslash — `\\**Budget**` half-strips. Correct would be an odd/even backslash-run count;
    // left alone deliberately, because it needs a literal backslash abutting a delimiter in a
    // meeting-note topic, and a mis-written parity lookbehind is likelier than the input.
    [GeneratedRegex(@"(?<![\w\\])(_{1,3})(?=\S)(.+?)(?<=\S)\1(?!\w)", RegexOptions.None,
        matchTimeoutMilliseconds: 1000)]
    private static partial Regex UnderscoreEmphasis();

    [GeneratedRegex(@"\s+", RegexOptions.None, matchTimeoutMilliseconds: 1000)]
    private static partial Regex Whitespace();

    private static string Key(string text) => text.Trim().ToLowerInvariant();

    // A derived topic has no event to carry an id, so the id is a deterministic function of the
    // note, the topic's text, and which occurrence of that text it is. Stable across rebuilds, and
    // unchanged by ticking (the text does not change), so the UI keeps its identity when a topic is
    // covered. Position is deliberately NOT hashed — that would churn every id below an insertion.
    // Not an RFC-4122 GUID (no version/variant nibbles); it is an opaque identifier, never parsed.
    private static Guid DeriveId(NoteId noteId, string key, int ordinal)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{noteId.Value:N}|{ordinal}|{key}"));
        return new Guid(bytes.AsSpan(0, 16));
    }
}
