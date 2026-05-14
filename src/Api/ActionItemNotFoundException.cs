using Domain.ActionItems;

namespace Api;

public sealed class ActionItemNotFoundException(ActionId actionId)
    : Exception($"Action item {actionId} not found.");
