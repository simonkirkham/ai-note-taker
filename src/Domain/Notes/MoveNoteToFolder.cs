using Domain.Folders;

namespace Domain.Notes;

public record MoveNoteToFolder(NoteId NoteId, FolderId FolderId) : NoteCommand;
