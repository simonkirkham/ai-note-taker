using System.ComponentModel;
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

    // The workspace the tool may read. The route id (not request input) scopes the read. Belt-and-
    // braces: RequireMcpAudienceFilter already 403s any request whose token `aud` is not bound to this
    // workspace BEFORE the tool runs; this re-checks the same binding at the data-access point so a
    // future mapping that forgets the filter still cannot leak across workspaces. Skipped only in the
    // no-auth proving config (no authenticated principal), where the route id alone scopes the read.
    private string AuthorizedWorkspace()
    {
        var ctx = httpContextAccessor.HttpContext
            ?? throw new InvalidOperationException("No HTTP context.");
        var workspaceId = ctx.Request.RouteValues["workspaceId"] as string
            ?? throw new InvalidOperationException("workspaceId route value is missing.");

        var options = ctx.RequestServices.GetService(typeof(McpOAuthOptions)) as McpOAuthOptions;
        if (options is not null && ctx.User.Identity?.IsAuthenticated == true)
        {
            var expected = options.ResourceUri(workspaceId);
            if (!ctx.User.FindAll("aud").Select(c => c.Value).Contains(expected, StringComparer.Ordinal))
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
