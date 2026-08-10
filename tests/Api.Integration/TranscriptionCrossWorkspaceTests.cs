using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

// BUG-72 made an incidental backend invariant load-bearing, so it is pinned here.
//
// The transcript commit used to fire DURING the route change; now the only commit fires when the
// on-device pass finishes, minutes later. If the user switched workspace in between, the URL is
// GUARANTEED to carry the new `wsId` rather than the note's — what was a narrow race is now the
// normal path for that scenario.
//
// It works because `WorkspaceValidationFilter` checks the caller OWNS the workspace in the path,
// and `CompleteTranscription` authorizes on the note's `UserId`, never on the note belonging to
// that workspace. Both are reasonable on their own; together they are what keeps a late commit
// alive. Nothing asserted it, so a future tightening of either would silently start losing
// transcripts — the failure would be invisible, minutes after the user left, in local mode only.
public sealed class TranscriptionCrossWorkspaceTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task CompleteTranscription_UnderADifferentOwnedWorkspace_Succeeds()
    {
        var noteId = await CreateNoteAsync();

        // A second workspace owned by the same user — the one the client would be scoped to after a
        // switch, while the note still lives in the default workspace.
        var createWs = await _client.PostAsync("/workspaces",
            JsonContent.Create(new { name = "Work" }));
        var otherWorkspaceId = (await createWs.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("workspaceId").GetString()!;

        var raw = factory.CreateRawClient();
        var resp = await raw.PostAsync(
            $"/w/{otherWorkspaceId}/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = "the finalised on-device transcript", durationSeconds = 42 }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var note = await (await _client.GetAsync($"/notes/{noteId}")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("the finalised on-device transcript", note.GetProperty("transcriptText").GetString());
    }

    private async Task<string> CreateNoteAsync()
    {
        var create = await _client.PostAsync("/notes", null);
        return (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
    }
}
