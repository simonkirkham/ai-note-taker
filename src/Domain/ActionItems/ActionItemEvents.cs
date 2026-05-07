using Domain.Notes;

namespace Domain.ActionItems;

public abstract record ActionItemEvent : IDomainEvent;

public record ActionItemAdded(ActionId ActionId, NoteId NoteId, string Description) : ActionItemEvent;
