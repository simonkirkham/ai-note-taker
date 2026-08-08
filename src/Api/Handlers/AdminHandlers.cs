using System.Diagnostics;
using Api.CommandHandlers;
using Api.Exceptions;
using Api.Observability;
using AWS.Lambda.Powertools.Logging;

namespace Api.Handlers;

public static class AdminHandlers
{
    // 43-H1: move every legacy agenda topic into its note's body, where 43-F/43-G expect it.
    // DRY RUN BY DEFAULT — this writes into real note content, so it must be inspected before it
    // acts: ?apply=true performs the writes. Idempotent, so a re-run after a partial failure is
    // safe. Run and verified BEFORE 43-H2 drops the legacy fold; without it those notes' topics
    // would simply disappear.
    public static async Task<IResult> MigrateAgenda(
        IAgendaMigrationHandler handler, bool? apply, CancellationToken ct)
    {
        var dryRun = apply != true;
        var result = await handler.MigrateAsync(dryRun, ct).ConfigureAwait(false);
        Logger.LogInformation(
            "Agenda migration {Mode} Scanned={Scanned} Migrated={Migrated} Topics={Topics} Skipped={Skipped}",
            dryRun ? "DRY RUN" : "APPLIED", result.NotesScanned, result.NotesMigrated,
            result.TopicsMigrated, result.NotesSkipped);
        return Results.Ok(new
        {
            dryRun,
            notesScanned = result.NotesScanned,
            notesMigrated = result.NotesMigrated,
            topicsMigrated = result.TopicsMigrated,
            notesSkipped = result.NotesSkipped,
            details = result.Details,
        });
    }

    public static async Task<IResult> RebuildProjections(
        IProjectionRebuildHandler handler, IDomainMetrics metrics, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            var result = await handler.RebuildAsync(ct);
            sw.Stop();
            metrics.ProjectionRebuildDuration(sw.Elapsed.TotalMilliseconds);
            Logger.LogInformation(
                "Projection rebuild complete DurationMs={DurationMs} StaleDeleted={StaleDeleted}",
                sw.Elapsed.TotalMilliseconds, result.StaleDeleted);
            return Results.Ok(new { rebuilt = result.Counts, staleDeleted = result.StaleDeleted });
        }
        catch (RebuildInProgressException)
        {
            // Expected single-flight backpressure, not a fault — mapped to 409, no fault metric.
            throw;
        }
        catch (Exception)
        {
            // BUG-23: a TRANSIENT timeout never reaches here — the handler's bounded retry
            // (BoundedWrites) recovers it and returns 200. Anything that escapes is a rebuild
            // that genuinely could not finish (incl. a persistent timeout now mapped to 503),
            // which is a real fault worth the metric.
            metrics.ProjectionRebuildFault();
            throw;
        }
    }
}
