using Domain.Notes;

namespace Api.Exceptions;

public sealed class NoteNotFoundException(NoteId noteId) : Exception($"Note {noteId} not found.");
