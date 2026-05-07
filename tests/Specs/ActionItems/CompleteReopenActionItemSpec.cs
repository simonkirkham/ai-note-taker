using Domain.ActionItems;
using Domain.Notes;
using Specs.Harness;

namespace Specs.ActionItems;

public sealed class CompleteReopenActionItemSpec
{
    static readonly ActionId ActionId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void CompletesOpenActionItem()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))
            .When(new CompleteActionItem(ActionId, At))
            .Then(new ActionItemCompleted(ActionId, At));
    }

    [Fact]
    public void RejectsCompletingAlreadyCompletedItem()
    {
        Spec
            .Given<ActionItem>(
                new ActionItemAdded(ActionId, NoteId, "Chase invoice"),
                new ActionItemCompleted(ActionId, At))
            .When(new CompleteActionItem(ActionId, At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void ReopensCompletedActionItem()
    {
        Spec
            .Given<ActionItem>(
                new ActionItemAdded(ActionId, NoteId, "Chase invoice"),
                new ActionItemCompleted(ActionId, At))
            .When(new ReopenActionItem(ActionId, At))
            .Then(new ActionItemReopened(ActionId, At));
    }

    [Fact]
    public void RejectsReopeningOpenItem()
    {
        Spec
            .Given<ActionItem>(new ActionItemAdded(ActionId, NoteId, "Chase invoice"))
            .When(new ReopenActionItem(ActionId, At))
            .ThenThrows<InvalidOperationException>();
    }
}
