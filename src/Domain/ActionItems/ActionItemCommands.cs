using Domain.Notes;

namespace Domain.ActionItems;

public abstract record ActionItemCommand : ICommand;

public record AddActionItem(ActionId ActionId, NoteId NoteId, string Description) : ActionItemCommand;
public record CompleteActionItem(ActionId ActionId, DateTimeOffset CompletedAt) : ActionItemCommand;
public record ReopenActionItem(ActionId ActionId, DateTimeOffset ReopenedAt) : ActionItemCommand;
