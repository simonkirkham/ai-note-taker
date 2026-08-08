using Domain.Notes;
using EventStore.Projections;

namespace Api.CommandHandlers;

public sealed record AgendaMigrationResult(
    int NotesScanned, int NotesMigrated, int TopicsMigrated, int NotesSkipped, IReadOnlyList<string> Details);

public interface IAgendaMigrationHandler
{
    Task<AgendaMigrationResult> MigrateAsync(bool dryRun, CancellationToken ct = default);
}

/// <summary>
/// Phase 43-H1 — move every legacy agenda topic into its note's body, where 43-F/43-G expect it.
///
/// Pre-43-F topics live as AgendaItem* events and have no line in the note. Once 43-H2 drops the
/// legacy fold they would simply vanish, so they are written into the body FIRST, as a checklist at
/// the top, preserving ticked state. Only after this has run and been verified is it safe to remove
/// the legacy path — the strangler ordering the phase mandates.
///
/// Writes go through the normal EditContent command (never a direct projection write), so the change
/// is an ordinary event on the note's stream: auditable, and revertible like any other edit.
/// </summary>
public sealed class AgendaMigrationHandler(
    INoteDetailStore noteDetailStore,
    INoteCommandHandler noteCommandHandler) : IAgendaMigrationHandler
{
    public async Task<AgendaMigrationResult> MigrateAsync(bool dryRun, CancellationToken ct = default)
    {
        var notes = await noteDetailStore.QueryAllAsync(ct).ConfigureAwait(false);
        var details = new List<string>();
        int migrated = 0, topics = 0, skipped = 0;

        foreach (var note in notes)
        {
            ct.ThrowIfCancellationRequested();

            var legacy = (note.Agenda ?? []).Where(a => !a.Derived).OrderBy(a => a.Position).ToList();
            if (legacy.Count == 0) continue;

            // Idempotent: a topic already present as a task line in the body is not written again, so
            // a re-run after a partial failure cannot double-list anything. Matching is on the same
            // normalisation the server's own dedup uses, and unescapes both sides — the editor
            // re-serialises text with backslash escapes on the user's next save, so a literal
            // comparison would miss an already-migrated topic and duplicate it.
            var alreadyInBody = AgendaFromContent.Parse(note.NoteId, note.Content)
                .Select(t => Normalise(t.Text))
                .ToHashSet();

            var missing = legacy.Where(a => !alreadyInBody.Contains(Normalise(a.Text))).ToList();
            if (missing.Count == 0)
            {
                skipped++;
                details.Add($"{note.NoteId.Value:N} \"{Trim(note.Title)}\": all {legacy.Count} topic(s) already in the body");
                continue;
            }

            var checklist = string.Join("\n", missing.Select(a => $"- [{(a.Discussed ? 'x' : ' ')}] {a.Text}"));
            // Prepended, with a blank line, so the existing note reads exactly as before underneath.
            var newContent = string.IsNullOrWhiteSpace(note.Content)
                ? checklist
                : $"{checklist}\n\n{note.Content}";

            details.Add(
                $"{note.NoteId.Value:N} \"{Trim(note.Title)}\": {(dryRun ? "would migrate" : "migrated")} " +
                $"{missing.Count} topic(s) ({missing.Count(a => a.Discussed)} ticked), " +
                $"content {note.Content?.Length ?? 0}b -> {newContent.Length}b");

            if (!dryRun)
            {
                // No ExpectedBaseContentHash: this is an admin batch, not a user editing a loaded
                // view, and the content read and the write are adjacent. A concurrent user edit
                // would be caught by the append's own optimistic concurrency.
                await noteCommandHandler.HandleAsync(new EditContent(note.NoteId, newContent))
                    .ConfigureAwait(false);
            }

            migrated++;
            topics += missing.Count;
        }

        return new AgendaMigrationResult(notes.Count, migrated, topics, skipped, details);
    }

    private static string Normalise(string text) => text.Trim().Replace("\\", "").ToLowerInvariant();

    private static string Trim(string? title) =>
        string.IsNullOrWhiteSpace(title) ? "(untitled)" : title.Length > 40 ? title[..40] : title;
}
