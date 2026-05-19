namespace Api;

public interface IProjectionRebuildHandler
{
    Task<int> RebuildAsync(CancellationToken ct = default);
}
