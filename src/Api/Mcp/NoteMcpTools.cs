using System.ComponentModel;
using System.Text.Json;
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
        var workspaceId = WorkspaceIdFromRoute();
        var all = await cards.QueryAllAsync(ct).ConfigureAwait(false);
        var notes = all
            .Where(c => !c.Deleted && c.WorkspaceId == workspaceId)
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

    private string WorkspaceIdFromRoute()
    {
        var routeValue = httpContextAccessor.HttpContext?.Request.RouteValues["workspaceId"];
        return routeValue as string
            ?? throw new InvalidOperationException("workspaceId route value is missing.");
    }

    private static string BuildPreview(string content)
    {
        var stripped = MarkdownStripper.Strip(content);
        return stripped.Length > MaxPreviewLength
            ? stripped[..(MaxPreviewLength - 1)] + "…"
            : stripped;
    }
}
