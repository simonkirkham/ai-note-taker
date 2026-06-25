namespace Domain.ActionItems;

public record ActionItemCompleted(ActionId ActionId, DateTimeOffset CompletedAt) : ActionItemEvent;
