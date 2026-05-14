using Domain.Notes;

namespace Domain.ActionItems;

public record DeleteActionItem(ActionId ActionId, DateTimeOffset DeletedAt) : ActionItemCommand;
