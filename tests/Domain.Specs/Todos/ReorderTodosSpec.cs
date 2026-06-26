using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class ReorderTodosSpec
{
    const string Workspace = "ws-1";
    static readonly DateTimeOffset At = new(2026, 6, 25, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void RecordsTheNewOrder()
    {
        var order = new[] { "b", "a", "c" };
        Spec
            .Given<TodoOrdering>()
            .When(new ReorderTodos(Workspace, order, At))
            .Then(new TodoListReordered(Workspace, order, At));
    }

    [Fact]
    public void RejectsEmptyOrder()
    {
        Spec
            .Given<TodoOrdering>()
            .When(new ReorderTodos(Workspace, Array.Empty<string>(), At))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void ReReorderIsLastWriteWins()
    {
        var newOrder = new[] { "c", "a", "b" };
        Spec
            .Given<TodoOrdering>(new TodoListReordered(Workspace, new[] { "a", "b", "c" }, At))
            .When(new ReorderTodos(Workspace, newOrder, At))
            .Then(new TodoListReordered(Workspace, newOrder, At));
    }
}
