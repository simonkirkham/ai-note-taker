using System.Security.Claims;
using Api.Auth;
using Microsoft.AspNetCore.Http;

namespace Api.Integration;

internal sealed class FakeCurrentUser(IHttpContextAccessor httpContextAccessor) : ICurrentUser
{
    public const string TestUserId = "test-user-123";
    public const string TestUserName = "Test User";

    public string UserId =>
        httpContextAccessor.HttpContext?.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
        ?? TestUserId;

    public string Name => TestUserName;
}
