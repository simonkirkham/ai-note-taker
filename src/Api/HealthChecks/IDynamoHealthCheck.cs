namespace Api.HealthChecks;

public interface IDynamoHealthCheck
{
    Task<DynamoHealth> CheckAsync(CancellationToken ct = default);
}
