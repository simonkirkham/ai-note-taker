namespace Domain.Workspaces;

public record WorkspaceCreated(WorkspaceId WorkspaceId, string Name) : WorkspaceEvent;
public record WorkspaceRenamed(WorkspaceId WorkspaceId, string NewName) : WorkspaceEvent;
public record WorkspaceDeleted(WorkspaceId WorkspaceId) : WorkspaceEvent;

// 34-B: a calendar account is connected to this workspace. Provider is the calendar source
// ("google"; "microsoft" arrives in 34-C); AccountRef is the connected account's email (for the
// "Connected as …" label), null when the provider returned no email. Additive — never recorded for
// the reserved default workspace, which has no per-user aggregate stream (see WorkspaceCommandHandler).
public record WorkspaceCalendarConnected(WorkspaceId WorkspaceId, string Provider, string? AccountRef) : WorkspaceEvent;
public record WorkspaceCalendarDisconnected(WorkspaceId WorkspaceId) : WorkspaceEvent;
