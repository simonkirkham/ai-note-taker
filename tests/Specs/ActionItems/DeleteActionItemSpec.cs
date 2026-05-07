using Domain.ActionItems;
using Domain.Notes;
using Specs.Harness;

namespace Specs.ActionItems;

public sealed class DeleteActionItemSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact(Skip = "Pip: implement DeleteActionItem")]
    public void DeletesExistingActionItem()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Old task"))
            .When(new DeleteActionItem(ActionId, At))
            .Then(new ActionItemDeleted(ActionId, At));
    }

    [Fact(Skip = "Pip: implement DeleteActionItem")]
    public void RejectsDeletingNonExistentItem()
    {
        Spec
            .Given<ActionItem>()
            .When(new DeleteActionItem(ActionId, At))
            .ThenThrows<InvalidOperationException>();
    }
}
