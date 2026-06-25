using Domain.Folders;

namespace Api.Exceptions;

public sealed class FolderNotFoundException(FolderId folderId) : Exception($"Folder {folderId} not found.");
