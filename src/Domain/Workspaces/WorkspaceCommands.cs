namespace Domain.Workspaces;

public record CreateWorkspace(WorkspaceId WorkspaceId, string Name, DateTimeOffset CreatedAt) : WorkspaceCommand;
public record RenameWorkspace(WorkspaceId WorkspaceId, string NewName) : WorkspaceCommand;
public record DeleteWorkspace(WorkspaceId WorkspaceId) : WorkspaceCommand;
