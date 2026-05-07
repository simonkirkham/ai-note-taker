using Domain.ActionItems;
using Domain.Notes;
using Specs.Harness;

namespace Specs.ActionItems;

public sealed class AddActionItemSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));

    [Fact]
    public void AddsActionItemWhenItDoesNotExist()
    {
        Spec
            .Given<ActionItem>()
            .When(new AddActionItem(ActionId, NoteId, "Book meeting room"))
            .Then(new ActionItemAdded(ActionId, NoteId, "Book meeting room"));
    }

    [Fact]
    public void RejectsAddWhenActionItemAlreadyExists()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Book meeting room"))
            .When(new AddActionItem(ActionId, NoteId, "Book meeting room"))
            .ThenThrows<InvalidOperationException>();
    }
}
