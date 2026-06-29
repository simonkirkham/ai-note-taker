using DomainWorkspaceId = Domain.Workspaces.WorkspaceId;
using EventStore.Projections;

namespace Api.Auth;

// Endpoint filter on the `/w/{workspaceId}` route group: rejects a request whose
// workspace id is not the caller's (404) before the handler runs. The reserved
// default workspace (`__default__`) is always valid — it is synthesised per user
// and never stored, so it skips the ownership lookup.
public sealed class WorkspaceValidationFilter(IWorkspaceListStore workspaceListStore, ICurrentUser currentUser) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var wsId = context.HttpContext.Request.RouteValues.TryGetValue("workspaceId", out var v)
            ? v?.ToString()
            : null;

        if (!string.IsNullOrEmpty(wsId) && wsId != DomainWorkspaceId.DefaultValue)
        {
            var all = await workspaceListStore.GetAllAsync(context.HttpContext.RequestAborted).ConfigureAwait(false);
            var owned = all.Any(w => w.WorkspaceId.Value == wsId && w.UserId == currentUser.UserId);
            if (!owned)
                return Results.NotFound();
        }

        return await next(context).ConfigureAwait(false);
    }
}
