using Domain.Notes;

namespace Api;

public sealed class NoteNotFoundException(NoteId noteId) : Exception($"Note {noteId} not found.");
