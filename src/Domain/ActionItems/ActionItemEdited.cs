namespace Domain.ActionItems;

public record ActionItemEdited(ActionId ActionId, string NewDescription, DateTimeOffset EditedAt) : ActionItemEvent;
