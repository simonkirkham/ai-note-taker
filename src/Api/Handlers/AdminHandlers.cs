using System.Diagnostics;
using Api.CommandHandlers;
using Api.Exceptions;
using Api.Observability;
using AWS.Lambda.Powertools.Logging;

namespace Api.Handlers;

public static class AdminHandlers
{
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
