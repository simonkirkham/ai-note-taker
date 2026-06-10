using DomainWorkspaceId = Domain.Workspaces.WorkspaceId;

namespace Api.Auth;

public sealed class CurrentWorkspace(IHttpContextAccessor httpContextAccessor) : ICurrentWorkspace
{
    public string WorkspaceId
    {
        get
        {
            var route = httpContextAccessor.HttpContext?.Request.RouteValues;
            var fromRoute = route is not null && route.TryGetValue("workspaceId", out var v)
                ? v?.ToString()
                : null;
            return string.IsNullOrEmpty(fromRoute) ? DomainWorkspaceId.DefaultValue : fromRoute;
        }
    }
}
