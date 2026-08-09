using Domain.Notes;

namespace Api.Exceptions;

// BUG-59: the caller is not the note's owner. A subtype of NoteNotFoundException so every existing
// `catch (NoteNotFoundException)` keeps returning 404 and keeps not leaking existence — but the
// EditContent handler can catch it FIRST and answer with a bare 404 rather than the discriminated
// `note_not_found` body.
//
// Without the split, "this note was deleted" would be returned for a note that exists and belongs
// to someone else. That is wrong twice: it tells the user something false whenever the NoteDetail
// row is merely absent (projector lag — the condition BUG-30 warns about), and it turns the pair
// {bare 404, note_not_found} into an oracle for "a note with this id exists but is not yours".
public sealed class NoteNotOwnedException(NoteId noteId) : NoteNotFoundException(noteId);
