using Domain.ActionItems;

namespace Api.CommandHandlers;

public interface IActionItemCommandHandler
{
    Task<long> HandleAsync(AddActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(CompleteActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(ReopenActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteActionItem cmd, CancellationToken ct = default);
}
