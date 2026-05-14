using Domain.Notes;

namespace Domain.ActionItems;

public record ReopenActionItem(ActionId ActionId, DateTimeOffset ReopenedAt) : ActionItemCommand;
