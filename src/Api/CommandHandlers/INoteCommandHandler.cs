using Domain.Notes;

namespace Api.CommandHandlers;

public interface INoteCommandHandler
{
    Task<NoteId> HandleAsync(NoteCommand cmd, CancellationToken ct = default);
}
