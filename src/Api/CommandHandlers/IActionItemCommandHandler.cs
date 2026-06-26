using Domain.ActionItems;

namespace Api.CommandHandlers;

public interface IActionItemCommandHandler
{
    Task<long> HandleAsync(AddActionItem cmd, CancellationToken ct = default);
    // Identity-explicit overload (33-B2): adds an action item with an explicit owner for non-HTTP
    // callers (the analysis re-run on the diarized transcript). The HTTP overload delegates to it.
    Task<long> HandleAsync(AddActionItem cmd, string userId, CancellationToken ct = default);
    Task<long> HandleAsync(CompleteActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(ReopenActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(EditActionItem cmd, CancellationToken ct = default);
    Task<long> HandleAsync(DeleteActionItem cmd, CancellationToken ct = default);
}
