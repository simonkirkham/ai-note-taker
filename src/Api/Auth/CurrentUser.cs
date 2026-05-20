using System.Security.Claims;

namespace Api.Auth;

public sealed class CurrentUser(IHttpContextAccessor httpContextAccessor) : ICurrentUser
{
    public string UserId =>
        httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? throw new InvalidOperationException("No authenticated user.");

    public string Name =>
        httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.Name)?.Value
        ?? UserId;
}
