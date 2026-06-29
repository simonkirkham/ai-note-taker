using Domain.Todos;

namespace Api.CommandHandlers;

public interface ITodoCommandHandler
{
    // Returns the new stream version (the RYW write token) the endpoint echoes to the client.
    Task<long> HandleAsync(AddTodo cmd, CancellationToken ct = default);
    Task HandleAsync(CompleteTodo cmd, CancellationToken ct = default);
    Task HandleAsync(ReopenTodo cmd, CancellationToken ct = default);
    Task HandleAsync(EditTodo cmd, CancellationToken ct = default);
    Task HandleAsync(DeleteTodo cmd, CancellationToken ct = default);
}
