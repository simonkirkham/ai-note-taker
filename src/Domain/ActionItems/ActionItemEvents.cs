using Domain.Notes;

namespace Domain.ActionItems;

public abstract record ActionItemEvent : IDomainEvent;

public record ActionItemAdded(ActionId ActionId, NoteId NoteId, string Description) : ActionItemEvent;
public record ActionItemCompleted(ActionId ActionId, DateTimeOffset CompletedAt) : ActionItemEvent;
public record ActionItemReopened(ActionId ActionId, DateTimeOffset ReopenedAt) : ActionItemEvent;
