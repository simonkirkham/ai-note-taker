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
    // topic), `[ ]` or `[x]`, then the text. Deliberately NOT anchored to the start of the string
    // so it matches per line.
    [GeneratedRegex(@"^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]+(.+?)[ \t]*$", RegexOptions.Multiline)]
    private static partial Regex TaskLine();

    /// <summary>Topics read out of the note body, in document order.</summary>
    public static List<AgendaItemView> Parse(NoteId noteId, string? content)
    {
        var items = new List<AgendaItemView>();
        if (string.IsNullOrWhiteSpace(content)) return items;

        var position = 0;
        foreach (Match m in TaskLine().Matches(content))
        {
            var text = m.Groups[2].Value.Trim();
            if (text.Length == 0) continue;
            var discussed = m.Groups[1].Value is "x" or "X";
            items.Add(new AgendaItemView(DeriveId(noteId, text), text, discussed, position++, Derived: true));
        }
        return items;
    }

    /// <summary>
    /// The union folded into <see cref="NoteDetailView.Agenda"/> during the 43-F/43-H strangler
    /// window: topics read from the body, then any legacy <c>AgendaItem*</c> topic that has no
    /// matching body line. A matched pair is listed ONCE and the body wins — it is the surface the
    /// user just edited. 43-H migrates the stragglers into their bodies and drops the legacy fold.
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
            if (bodyText.Contains(Key(item.Text))) continue;
            fromBody.Add(item with { Position = position++ });
        }
        return fromBody.AsReadOnly();
    }

    private static string Key(string text) => text.Trim().ToLowerInvariant();

    // A derived topic has no event to carry an id, so the id is a deterministic function of the
    // note and the topic's text. Stable across rebuilds, and unchanged by ticking (the text does
    // not change), so the UI keeps its identity when a topic is covered.
    private static Guid DeriveId(NoteId noteId, string text)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes($"{noteId.Value:N}|{Key(text)}"));
        return new Guid(bytes.AsSpan(0, 16));
    }
}
