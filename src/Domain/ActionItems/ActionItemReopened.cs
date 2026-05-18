namespace Domain.ActionItems;

public record ActionItemReopened(ActionId ActionId, DateTimeOffset ReopenedAt) : ActionItemEvent;
