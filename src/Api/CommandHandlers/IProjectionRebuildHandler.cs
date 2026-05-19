namespace Api.CommandHandlers;

public interface IProjectionRebuildHandler
{
    Task<int> RebuildAsync(CancellationToken ct = default);
}
