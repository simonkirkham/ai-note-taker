using System.Security.Claims;

namespace Api.Auth;

public sealed class AllowlistMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var allowed = (Environment.GetEnvironmentVariable("ALLOWED_USER_SUBS") ?? "")
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (allowed.Length > 0)
            {
                var userId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
                if (userId is null || !allowed.Contains(userId))
                {
                    context.Response.StatusCode = 403;
                    return;
                }
            }
        }

        await next(context);
    }
}
