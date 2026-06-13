using Domain.Notes;

namespace Api.CommandHandlers;

public interface INoteCommandHandler
{
    // Returns the note stream's new version (the RYW write token): the read side waits on
    // proj-position until the async projector reaches it before answering. The caller already
    // holds the NoteId (it is passed into the command), so only the version is surfaced — the
    // same shape as ITodoCommandHandler since RYW-1.
    Task<long> HandleAsync(NoteCommand cmd, CancellationToken ct = default);
}
