using Domain.Todos;

namespace Api.CommandHandlers;

public interface ITodoOrderCommandHandler
{
    // Returns the new stream version so the endpoint can hand back a read-your-writes token.
    Task<long> HandleAsync(ReorderTodos cmd, CancellationToken ct = default);
    Task<long> HandleAsync(SetTodayLine cmd, CancellationToken ct = default);
}
