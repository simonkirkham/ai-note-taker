using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class SetTodayLineSpec
{
    const string Workspace = "ws-1";
    static readonly DateTimeOffset At = new(2026, 8, 6, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RecordsTheAnchoredPosition()
    {
        Spec
            .Given<TodoOrdering>()
            .When(new SetTodayLine(Workspace, "item-c", At))
            .Then(new TodayLineSet(Workspace, "item-c", At));
    }

    [Fact]
    public void ANullAnchorPutsTheLineBelowEverything()
    {
        Spec
            .Given<TodoOrdering>()
            .When(new SetTodayLine(Workspace, null, At))
            .Then(new TodayLineSet(Workspace, null, At));
    }

    [Fact]
    public void RejectsABlankAnchor()
    {
        Spec
            .Given<TodoOrdering>()
            .When(new SetTodayLine(Workspace, "   ", At))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void MovingTheLineAgainIsLastWriteWins()
    {
        Spec
            .Given<TodoOrdering>(new TodayLineSet(Workspace, "item-b", At))
            .When(new SetTodayLine(Workspace, "item-d", At))
            .Then(new TodayLineSet(Workspace, "item-d", At));
    }

    [Fact]
    public void TheLineAndTheOrderShareTheStreamWithoutInterfering()
    {
        var order = new[] { "a", "b", "c" };
        Spec
            .Given<TodoOrdering>(new TodayLineSet(Workspace, "b", At))
            .When(new ReorderTodos(Workspace, order, At))
            .Then(new TodoListReordered(Workspace, order, At));
    }
}
