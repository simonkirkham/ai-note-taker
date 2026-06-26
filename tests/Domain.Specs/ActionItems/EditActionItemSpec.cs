using Domain.ActionItems;
using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.ActionItems;

public sealed class EditActionItemSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void EditsOpenActionItem()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))
            .When(new EditActionItem(ActionId, "Chase Acme invoice", At))
            .Then(new ActionItemEdited(ActionId, "Chase Acme invoice", At));
    }

    [Fact]
    public void EditsCompletedActionItemAndPreservesCompletion()
    {
        Spec
            .Given<ActionItem>(
                new ActionItemAdded(ActionId, NoteId, "Chase invoice"),
                new ActionItemCompleted(ActionId, At))
            .When(new EditActionItem(ActionId, "Chase Acme invoice", At))
            .Then(new ActionItemEdited(ActionId, "Chase Acme invoice", At));
    }

    [Fact]
    public void RejectsEditingDeletedActionItem()
    {
        Spec
            .Given<ActionItem>(
                new ActionItemAdded(ActionId, NoteId, "Chase invoice"),
                new ActionItemDeleted(ActionId, At))
            .When(new EditActionItem(ActionId, "Chase Acme invoice", At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsEmptyDescription()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))
            .When(new EditActionItem(ActionId, "   ", At))
            .ThenThrows<ArgumentException>();
    }
}
