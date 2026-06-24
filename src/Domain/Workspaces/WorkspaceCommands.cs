namespace Domain.Workspaces;

public record CreateWorkspace(WorkspaceId WorkspaceId, string Name) : WorkspaceCommand;
public record RenameWorkspace(WorkspaceId WorkspaceId, string NewName) : WorkspaceCommand;
public record DeleteWorkspace(WorkspaceId WorkspaceId) : WorkspaceCommand;
public record ConnectWorkspaceCalendar(WorkspaceId WorkspaceId, string Provider, string? AccountRef) : WorkspaceCommand;
public record DisconnectWorkspaceCalendar(WorkspaceId WorkspaceId) : WorkspaceCommand;
