namespace Api.Auth;

// The workspace the current request is scoped to. Resolved from the `/w/{workspaceId}`
// route prefix; rootless routes (no prefix) resolve to the reserved default workspace.
public interface ICurrentWorkspace
{
    string WorkspaceId { get; }
}
