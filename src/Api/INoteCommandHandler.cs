using Domain.Notes;

namespace Api;

public interface INoteCommandHandler
{
    Task<NoteId> HandleAsync(NoteCommand cmd, CancellationToken ct = default);
}
