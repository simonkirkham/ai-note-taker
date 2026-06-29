using Domain.Todos;
using Domain.Specs.Harness;

namespace Domain.Specs.Todos;

public sealed class AddTodoSpec
{
    static readonly TodoId TodoId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    const string UserId = "user-1";

    [Fact]
    public void AddsTodoWhenItDoesNotExist()
    {
        Spec
            .Given<Todo>()
            .When(new AddTodo(TodoId, UserId, "Buy milk", null))
            .Then(new TodoAdded(TodoId, UserId, "Buy milk", null));
    }

    [Fact]
    public void AddsTodoWithPriority()
    {
        Spec
            .Given<Todo>()
            .When(new AddTodo(TodoId, UserId, "Buy milk", "Today"))
            .Then(new TodoAdded(TodoId, UserId, "Buy milk", "Today"));
    }

    [Fact]
    public void RejectsAddWhenTodoAlreadyExists()
    {
        Spec
            .Given<Todo>(new TodoAdded(TodoId, UserId, "Buy milk", null))
            .When(new AddTodo(TodoId, UserId, "Buy milk", null))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsAddWithEmptyDescription()
    {
        Spec
            .Given<Todo>()
            .When(new AddTodo(TodoId, UserId, "   ", null))
            .ThenThrows<ArgumentException>();
    }
}
