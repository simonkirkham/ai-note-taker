using Domain.Folders;

namespace Domain.Notes;

public record NoteFiledInFolder(NoteId NoteId, FolderId FolderId) : NoteEvent;
