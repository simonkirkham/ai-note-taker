using System.ComponentModel;
using System.Security.Claims;
using System.Text.Json;
using Api.Auth;
using Api.Mcp.OAuth;
using Api.Utilities;
using EventStore.Projections;
using ModelContextProtocol.Server;

namespace Api.Mcp;

[McpServerToolType]
public sealed class NoteMcpTools(INoteCardListStore cards, IHttpContextAccessor httpContextAccessor)
{
    private const int MaxPreviewLength = 120;

    [McpServerTool(Name = "list_notes", ReadOnly = true)]
    [Description("List the note cards in this workspace: id, title, date and a short content preview.")]
    public async Task<string> ListNotes(CancellationToken ct)
    {
        var workspaceId = AuthorizedWorkspace();
        var all = await cards.QueryAllAsync(ct).ConfigureAwait(false);
        var notes = all
            .Where(c => !c.Deleted && WorkspaceScopeExtensions.Matches(workspaceId, c.WorkspaceId))
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                id = c.NoteId.Value.ToString(),
                title = c.Title,
                date = c.Date?.ToString("yyyy-MM-dd"),
                preview = BuildPreview(c.Content)
            });
        return JsonSerializer.Serialize(new { notes });
    }

    // The workspace the tool may read. Since 35-E the request carries a validated audience-bound
    // bearer, so this enforces (a) the token's `aud` is bound to THIS workspace's resource URI — a
    // token minted for another workspace is rejected here even though it is a valid token of ours
    // (the per-workspace half of the RFC 8707 confused-deputy guard) — before returning the route
    // workspace id. The route id (not request input) scopes the read.
    private string AuthorizedWorkspace()
    {
        var ctx = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("No HTTP context.");
        var workspaceId = ctx.Request.RouteValues["workspaceId"] as string
            ?? throw new InvalidOperationException("workspaceId route value is missing.");

        var options = ctx.RequestServices.GetService(typeof(McpOAuthOptions)) as McpOAuthOptions;
        // When OAuth is wired (prod/35-E and the RS tests), require the token's audience to be bound
        // to this exact workspace. When it is not wired (the no-auth proving config), skip — the route
        // id alone scopes the read, exactly as in 35-A.
        if (options is not null && ctx.User.Identity?.IsAuthenticated == true)
        {
            var expected = options.ResourceUri(workspaceId);
            var audiences = ctx.User.FindAll("aud").Select(c => c.Value)
                .Concat(ctx.User.FindAll(ClaimTypes.Uri).Select(c => c.Value));
            if (!audiences.Contains(expected, StringComparer.Ordinal))
                throw new UnauthorizedAccessException("Token audience is not bound to this workspace.");
        }

        return workspaceId;
    }

    private static string BuildPreview(string content)
    {
        var stripped = MarkdownStripper.Strip(content);
        return stripped.Length > MaxPreviewLength
            ? stripped[..MaxPreviewLength] + "…"
            : stripped;
    }
}
