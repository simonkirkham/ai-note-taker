namespace Domain.ActionItems;

public record EditActionItem(ActionId ActionId, string NewDescription, DateTimeOffset EditedAt) : ActionItemCommand;
