using Domain.Folders;

namespace Api;

public sealed class FolderNotFoundException(FolderId folderId) : Exception($"Folder {folderId} not found.");
