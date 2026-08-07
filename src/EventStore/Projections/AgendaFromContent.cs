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

            var text = Unescape(m.Groups[2].Value.Trim());
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

        var bodyText = fromBody.Select(i => Key(i.Text)).ToHashSet();
        var position = fromBody.Count;
        foreach (var item in legacy)
        {
            // Unescape the legacy text too, so a topic migrated into the body in 43-H still matches
            // after the editor re-serialises it with escapes.
            if (bodyText.Contains(Key(Unescape(item.Text)))) continue;
            fromBody.Add(item with { Position = position++ });
        }
        return fromBody.AsReadOnly();
    }

    private static string Unescape(string text) => Escaped().Replace(text, "$1");

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
