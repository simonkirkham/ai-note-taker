using Domain.Notes;

namespace Api.Exceptions;

// Not sealed: NoteNotOwnedException derives from it so the owner-mismatch 404 stays a 404
// everywhere, while EditContent can still tell the two apart (BUG-59).
public class NoteNotFoundException(NoteId noteId) : Exception($"Note {noteId} not found.");
