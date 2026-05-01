using Api;

namespace ApiIntegration;

public sealed class AlwaysHealthyDynamoCheck : IDynamoHealthCheck
{
    public Task<DynamoHealth> CheckAsync(CancellationToken ct = default) =>
        Task.FromResult(new DynamoHealth(true));
}
