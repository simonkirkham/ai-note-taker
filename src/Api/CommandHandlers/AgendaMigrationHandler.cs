using Api.Auth;
using Api.Exceptions;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Api.CommandHandlers;

public sealed record AgendaMigrationNote(
    string NoteId, string Title, int Topics, string Outcome, int ContentBefore, int ContentAfter,
    string? ResultingContent);

public sealed record AgendaMigrationResult(
    int NotesScanned, int NotesWithLegacyTopics, int NotesMigrated, int TopicsMigrated,
    int NotesStale, int NotesFailed, int NotesExcludedNotOwned,
    IReadOnlyList<AgendaMigrationNote> Notes);

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
/// This is a read-modify-write of the user's real note content, so BOTH sides come from the event
/// stream, never from the async NoteDetail projection:
///
///   * WHAT TO MIGRATE — the full event log is folded in memory through the very same
///     NoteDetailProjection the projector and ProjectionRebuildHandler use. So "which topics are
///     still legacy" has exactly one definition (AgendaFromContent.Compose leaves a legacy topic in
///     the view only when no body line matches it), the run needs no prior projection rebuild to be
///     correct, and a deleted note — which the fold drops — can never be resurrected.
///   * WHAT TO WRITE ONTO — every EditContent carries ExpectedBaseContentHash of the content this
///     scan actually built from. Reading a lagging projection and replacing the whole body would
///     silently drop a save made in the meantime; worse, NoteCommandHandler retries a
///     ConcurrencyException by re-running the command, which would re-apply the same stale body.
///     With the hash, each retry re-checks against the freshly-read stream and a moved note is
///     REJECTED (StaleContentEditException) rather than overwritten — reported as "stale", to be
///     picked up by a re-run.
///
/// Writes go through the normal EditContent command (never a direct projection write), so the change
/// is an ordinary event on the note's stream: auditable, and revertible like any other edit. The
/// scoped ICurrentUser identity is used deliberately — the command handler then applies its own
/// event-stream ownership check, a second gate behind the owner filter below.
/// </summary>
public sealed class AgendaMigrationHandler(
    IEventStore store,
    INoteCommandHandler noteCommandHandler,
    ICurrentUser currentUser,
    ILogger<AgendaMigrationHandler> logger) : IAgendaMigrationHandler
{
    // Single-flight, as the rebuild is: two concurrent runs would each read the same pre-migration
    // content and the second would lose its hash check, turning a clean re-run into noise. Static so
    // it gates across requests on a warm Lambda (WaitAsync(0) -> reject rather than queue).
    private static readonly SemaphoreSlim MigrationLock = new(1, 1);

    public async Task<AgendaMigrationResult> MigrateAsync(bool dryRun, CancellationToken ct = default)
    {
        if (!await MigrationLock.WaitAsync(0, ct).ConfigureAwait(false))
            throw new MigrationInProgressException();
        try
        {
            return await MigrateCoreAsync(dryRun, ct).ConfigureAwait(false);
        }
        finally
        {
            MigrationLock.Release();
        }
    }

    private async Task<AgendaMigrationResult> MigrateCoreAsync(bool dryRun, CancellationToken ct)
    {
        // Same bounded retry the rebuild wraps this scan in (BUG-23): it is the heaviest read here
        // and the one prod has already seen time out.
        var events = await BoundedWrites
            .WithRetryAsync(store.ReadAllStreamsAsync, ct: ct).ConfigureAwait(false);

        var projection = new NoteDetailProjection();
        foreach (var e in events)
            projection.Handle(e);

        var all = projection.GetAllDetails();
        var owned = all.Where(n => n.UserId == currentUser.UserId).ToList();
        // Counted, not silently dropped: an operator reconciling against the measured scope (8 notes,
        // 36 topics) needs to see that a note with legacy topics was excluded for ownership rather
        // than wonder why the totals disagree. A pre-Phase-8 note folds to UserId "" and lands here.
        var excluded = all.Count(n => n.UserId != currentUser.UserId
            && (n.Agenda ?? []).Any(a => !a.Derived));
        // A legacy topic is one Compose could not match to a body line. A note whose topics are all
        // already in the body therefore never reaches this list — there is nothing to write.
        var candidates = owned
            .Where(n => (n.Agenda ?? []).Any(a => !a.Derived))
            .OrderBy(n => n.NoteId.Value)
            .ToList();

        var report = new List<AgendaMigrationNote>();
        int migrated = 0, topics = 0, stale = 0, failed = 0;

        foreach (var note in candidates)
        {
            ct.ThrowIfCancellationRequested();

            var missing = (note.Agenda ?? [])
                .Where(a => !a.Derived)
                .OrderBy(a => a.Position)
                .Select(a => a with { Text = SingleLine(a.Text) })
                .Where(a => a.Text.Length > 0)
                .ToList();
            if (missing.Count == 0) continue;

            var checklist = string.Join("\n",
                missing.Select(a => $"- [{(a.Discussed ? 'x' : ' ')}] {a.Text}"));
            // Prepended with a blank line, the original body following byte-for-byte. Verified
            // against the real notes: the checklist stays its own task list and does not merge into
            // a body that itself opens with a bullet list.
            // IsNullOrEmpty, deliberately NOT IsNullOrWhiteSpace: a line holding a single space is a
            // BUG-40 blank-line paragraph, real content the user typed, and discarding it would be
            // exactly the silent loss this slice exists to avoid.
            var newContent = string.IsNullOrEmpty(note.Content)
                ? checklist
                : $"{checklist}\n\n{note.Content}";

            AgendaMigrationNote Line(string outcome, bool withContent = true) => new(
                note.NoteId.Value.ToString("N"), Title(note.Title), missing.Count, outcome,
                note.Content?.Length ?? 0, newContent.Length, withContent ? newContent : null);

            if (dryRun)
            {
                migrated++;
                topics += missing.Count;
                report.Add(Line("would migrate"));
                continue;
            }

            // Per-note isolation: one bad note must not cost the record of which notes were already
            // written. Every outcome lands in the report AND in the log, at the moment it happens —
            // an API-Gateway timeout can still take the response away.
            try
            {
                await noteCommandHandler.HandleAsync(
                    new EditContent(note.NoteId, newContent, NoteContentHash.Compute(note.Content)),
                    ct).ConfigureAwait(false);
                migrated++;
                topics += missing.Count;
                logger.LogInformation(
                    "Agenda migration wrote NoteId={NoteId} Topics={Topics} Before={Before} After={After}",
                    note.NoteId.Value, missing.Count, note.Content?.Length ?? 0, newContent.Length);
                report.Add(Line("migrated"));
            }
            catch (StaleContentEditException)
            {
                // The note changed between the scan and the write, so the body this run built on is
                // no longer current. Rejected, not overwritten — a re-run picks it up from the note
                // as it now stands.
                stale++;
                logger.LogWarning(
                    "Agenda migration skipped NoteId={NoteId} — content changed after the scan",
                    note.NoteId.Value);
                report.Add(Line("stale — the note changed after the scan; re-run", withContent: false));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failed++;
                logger.LogError(ex, "Agenda migration FAILED NoteId={NoteId}", note.NoteId.Value);
                report.Add(Line($"FAILED: {ex.GetType().Name}: {ex.Message}", withContent: false));
            }
        }

        logger.LogInformation(
            "Agenda migration {Mode} Scanned={Scanned} WithLegacy={WithLegacy} Migrated={Migrated} " +
            "Topics={Topics} Stale={Stale} Failed={Failed} ExcludedNotOwned={Excluded}",
            dryRun ? "DRY RUN" : "APPLIED", owned.Count, candidates.Count, migrated, topics, stale,
            failed, excluded);

        return new AgendaMigrationResult(
            owned.Count, candidates.Count, migrated, topics, stale, failed, excluded, report);
    }

    // AddAgendaItem only trimmed the topic, so a legacy topic may hold a newline or tab. Written
    // raw it would break the checklist into a line Parse cannot match, and every re-run would list
    // it again and re-inject the stray markup.
    private static string SingleLine(string text) =>
        string.Join(' ', text.Split(['\r', '\n', '\t'], StringSplitOptions.RemoveEmptyEntries
            | StringSplitOptions.TrimEntries));

    private static string Title(string? title) =>
        string.IsNullOrWhiteSpace(title) ? "(untitled)" : title.Length > 60 ? title[..60] : title;
}
