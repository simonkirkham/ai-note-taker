using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class EditTodoSpec
{
    static readonly TodoId TodoId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    const string UserId = "user-1";
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void EditsOpenTodo()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new EditTodo(TodoId, "Buy oat milk", At))
            .Then(new TodoEdited(TodoId, "Buy oat milk", At));
    }

    [Fact]
    public void EditsCompletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoCompleted(TodoId, At))
            .When(new EditTodo(TodoId, "Buy oat milk", At))
            .Then(new TodoEdited(TodoId, "Buy oat milk", At));
    }

    [Fact]
    public void RejectsEditingDeletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoDeleted(TodoId, At))
            .When(new EditTodo(TodoId, "Buy oat milk", At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsEmptyDescription()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new EditTodo(TodoId, "   ", At))
            .ThenThrows<ArgumentException>();
    }
}
