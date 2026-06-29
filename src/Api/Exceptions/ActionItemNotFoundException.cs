using Domain.ActionItems;

namespace Api.Exceptions;

public sealed class ActionItemNotFoundException(ActionId actionId)
    : Exception($"Action item {actionId} not found.");
