using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class DeleteTodoSpec
{
    static readonly TodoId TodoId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
    const string UserId = "user-1";

    [Fact]
    public void DeletesOpenTodo()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new DeleteTodo(TodoId, At))
            .Then(new TodoDeleted(TodoId, At));
    }

    [Fact]
    public void DeletesCompletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoCompleted(TodoId, At))
            .When(new DeleteTodo(TodoId, At))
            .Then(new TodoDeleted(TodoId, At));
    }

    [Fact]
    public void RejectsDeletingAlreadyDeletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoDeleted(TodoId, At))
            .When(new DeleteTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDeletingNonExistentTodo()
    {
        Spec
            .Given<Todo>()
            .When(new DeleteTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }
}
