using Api.Auth;

namespace Api.Services;

// 42-A: the identity + workspace a calendar resolution is for. Every calendar consumer (the token
// sources, the ICS client, the client factory) resolves tokens keyed by (userId, workspaceId). On an
// HTTP route those come from the request — `ICurrentUser` (the `sub` claim) and `ICurrentWorkspace`
// (the `/w/{workspaceId}` route segment). But the MCP endpoint is a single `/mcp` path with NO
// workspace in the URL, so `ICurrentWorkspace` always resolves to the default workspace there. This
// scope lets a caller off the HTTP route — the MCP tools — set the identity explicitly (token `sub` +
// the `workspaceId` argument) before resolving a calendar. Default (no override) reads the route +
// claims, so every existing HTTP calendar path is unchanged.
public interface ICalendarScope
{
    string UserId { get; }
    string WorkspaceId { get; }
}

public sealed class CalendarScope(ICurrentUser currentUser, ICurrentWorkspace currentWorkspace) : ICalendarScope
{
    private string? _userId;
    private string? _workspaceId;

    // Override the scope for the rest of this request (the MCP tools call this with the token `sub`
    // and the workspaceId argument). Scoped lifetime, so the override never leaks across requests.
    // Assumes one tool call per DI scope: a Set followed by its own resolve. The CalendarClientFactory
    // guards this fail-closed (it throws if a resolve's workspaceId != this scope's), so a hypothetical
    // concurrent second Set within one scope errors rather than serving cross-workspace data.
    public void Set(string userId, string workspaceId)
    {
        _userId = userId;
        _workspaceId = workspaceId;
    }

    public string UserId => _userId ?? currentUser.UserId;
    public string WorkspaceId => _workspaceId ?? currentWorkspace.WorkspaceId;
}
