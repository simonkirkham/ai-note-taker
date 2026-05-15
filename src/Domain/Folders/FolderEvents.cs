namespace Domain.Folders;

public record FolderCreated(FolderId FolderId, string Name, FolderId? ParentFolderId) : FolderEvent;
public record FolderRenamed(FolderId FolderId, string NewName) : FolderEvent;
public record FolderDeleted(FolderId FolderId) : FolderEvent;
public record FolderMoved(FolderId FolderId, FolderId? NewParentFolderId) : FolderEvent;
