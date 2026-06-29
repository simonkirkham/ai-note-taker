namespace Api.Contracts;

public record AddActionItemRequest(string Description, System.Guid? ActionId = null);
