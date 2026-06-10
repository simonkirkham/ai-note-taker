namespace Domain.Workspaces;

public record WorkspaceCreated(WorkspaceId WorkspaceId, string Name) : WorkspaceEvent;
public record WorkspaceRenamed(WorkspaceId WorkspaceId, string NewName) : WorkspaceEvent;
public record WorkspaceDeleted(WorkspaceId WorkspaceId) : WorkspaceEvent;
