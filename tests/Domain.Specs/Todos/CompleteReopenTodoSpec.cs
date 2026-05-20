using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class CompleteReopenTodoSpec
{
    static readonly TodoId TodoId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly DateTimeOffset At = new(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
    const string UserId = "user-1";

    [Fact]
    public void CompletesOpenTodo()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new CompleteTodo(TodoId, At))
            .Then(new TodoCompleted(TodoId, At));
    }

    [Fact]
    public void RejectsCompletingAlreadyCompletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoCompleted(TodoId, At))
            .When(new CompleteTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsCompletingNonExistentTodo()
    {
        Spec
            .Given<Todo>()
            .When(new CompleteTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void ReopensCompletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoCompleted(TodoId, At))
            .When(new ReopenTodo(TodoId, At))
            .Then(new TodoReopened(TodoId, At));
    }

    [Fact]
    public void RejectsReopeningOpenTodo()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new ReopenTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsReopeningDeletedTodo()
    {
        Spec
            .Given<Todo>(
                new TodoAdded(TodoId, UserId, "Buy milk", null),
                new TodoCompleted(TodoId, At),
                new TodoDeleted(TodoId, At))
            .When(new ReopenTodo(TodoId, At))
            .ThenThrows<InvalidOperationException>();
    }
}
