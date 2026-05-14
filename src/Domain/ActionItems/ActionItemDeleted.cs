using Domain.Notes;

namespace Domain.ActionItems;

public record ActionItemDeleted(ActionId ActionId, DateTimeOffset DeletedAt) : ActionItemEvent;
