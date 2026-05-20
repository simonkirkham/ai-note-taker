using Domain.Todos;

namespace Api.CommandHandlers;

public interface ITodoCommandHandler
{
    Task HandleAsync(AddTodo cmd, CancellationToken ct = default);
    Task HandleAsync(CompleteTodo cmd, CancellationToken ct = default);
    Task HandleAsync(ReopenTodo cmd, CancellationToken ct = default);
    Task HandleAsync(DeleteTodo cmd, CancellationToken ct = default);
}
