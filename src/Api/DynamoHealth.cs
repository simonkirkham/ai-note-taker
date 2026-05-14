namespace Api;

public record DynamoHealth(bool Reachable, string? Error = null);
