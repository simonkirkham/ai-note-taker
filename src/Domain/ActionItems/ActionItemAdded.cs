using Domain.Notes;

namespace Domain.ActionItems;

public record ActionItemAdded(ActionId ActionId, NoteId NoteId, string Description) : ActionItemEvent;
