using Domain.Notes;

namespace Domain.ActionItems;

public abstract record ActionItemCommand : ICommand;

public record AddActionItem(ActionId ActionId, NoteId NoteId, string Description) : ActionItemCommand;
