namespace Api.CommandHandlers;

public interface IProjectionRebuildHandler
{
    Task<ProjectionRebuildResult> RebuildAsync(CancellationToken ct = default);
}

// Per-projection upserted row counts plus the number of stale rows the reconcile pass
// deleted — surfaced so a partial or unexpectedly-small rebuild is visible, not silent.
public sealed record ProjectionRebuildResult(IReadOnlyDictionary<string, int> Counts, int StaleDeleted);
