namespace Domain.Folders;

public record CreateFolder(FolderId FolderId, string Name, FolderId? ParentFolderId, DateTimeOffset CreatedAt) : FolderCommand;
