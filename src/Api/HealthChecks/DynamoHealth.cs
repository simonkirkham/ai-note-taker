namespace Api.HealthChecks;

public record DynamoHealth(bool Reachable, string? Error = null);
