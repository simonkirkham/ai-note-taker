namespace Api;

public interface IDynamoHealthCheck
{
    Task<DynamoHealth> CheckAsync(CancellationToken ct = default);
}
