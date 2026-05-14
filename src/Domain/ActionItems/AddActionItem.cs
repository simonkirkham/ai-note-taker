using Domain.Notes;

namespace Domain.ActionItems;

public record AddActionItem(ActionId ActionId, NoteId NoteId, string Description) : ActionItemCommand;
