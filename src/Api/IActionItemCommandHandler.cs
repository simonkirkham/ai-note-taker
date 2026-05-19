using Domain.ActionItems;

namespace Api;

public interface IActionItemCommandHandler
{
    Task<ActionId> HandleAsync(AddActionItem cmd, CancellationToken ct = default);
    Task HandleAsync(CompleteActionItem cmd, CancellationToken ct = default);
    Task HandleAsync(ReopenActionItem cmd, CancellationToken ct = default);
    Task HandleAsync(DeleteActionItem cmd, CancellationToken ct = default);
}
