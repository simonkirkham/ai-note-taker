using Domain.Notes;

namespace Domain.ActionItems;

public record CompleteActionItem(ActionId ActionId, DateTimeOffset CompletedAt) : ActionItemCommand;
