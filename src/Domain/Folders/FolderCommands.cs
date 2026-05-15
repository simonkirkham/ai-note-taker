namespace Domain.Folders;

public record CreateFolder(FolderId FolderId, string Name, FolderId? ParentFolderId, DateTimeOffset CreatedAt) : FolderCommand;
public record RenameFolder(FolderId FolderId, string NewName) : FolderCommand;
public record DeleteFolder(FolderId FolderId) : FolderCommand;
public record MoveFolder(FolderId FolderId, FolderId? NewParentFolderId) : FolderCommand;
