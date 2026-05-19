using Domain.Folders;

namespace EventStore.Projections;

public record FolderTreeView(FolderId FolderId, string Name, FolderId? ParentFolderId, DateTimeOffset CreatedAt, string UserId = "");
