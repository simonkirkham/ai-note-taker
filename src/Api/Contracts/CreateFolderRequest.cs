namespace Api.Contracts;

public record CreateFolderRequest(string Name, Guid? ParentFolderId);
