namespace Domain.Folders;

public record FolderCreated(FolderId FolderId, string Name, FolderId? ParentFolderId) : FolderEvent;
