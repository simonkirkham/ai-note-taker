using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

// BUG-46: deleting a folder cascades an `UnfileNote` NOTE-stream write per contained note, but the
// delete response only ever carried the FOLDER-tree token. `useDeleteFolder` invalidates
// keys.noteCards, so its onSettled cards refetch was ungated w.r.t. those unfile writes — the
// contained notes could still render under the (now-gone) folder until the projector caught up.
//
// The cards LIST gate holds a SINGLE stream token (design decision #7 — a list read waits on the
// most recently written stream), so the delete returns the LAST unfile write's note token in a
// second header. That matches the existing list-gate semantics rather than inventing multi-stream
// gating for this one flow.
public sealed class FolderDeleteCascadeConsistencyTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task DeleteFolder_WithContainedNotes_ReturnsANoteCardsConsistencyToken()
    {
        var folderId = await CreateFolderAsync("Doomed");
        var noteId = await CreateNoteInFolderAsync(folderId);

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();

        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-Notes"));
        var (stream, version) = ParseToken(notesToken);
        Assert.Equal($"note#{noteId}", stream);
        Assert.True(version >= 1, $"expected a positive version, got {version}");

        // The folder-tree token is unchanged — both scopes are gated, not one at the other's cost.
        var folderToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token"));
        Assert.Equal($"folder-{Guid.Parse(folderId):N}", ParseToken(folderToken).Stream);
    }

    [Fact]
    public async Task DeleteFolder_NoteCardsGatedOnThatToken_ShowsTheNoteUnfiled()
    {
        var folderId = await CreateFolderAsync("Doomed");
        var noteId = await CreateNoteInFolderAsync(folderId);

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();
        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-Notes"));

        var req = new HttpRequestMessage(HttpMethod.Get, "/notes/cards");
        req.Headers.Add("If-Consistent-With", notesToken);
        var cardsResp = await _client.SendAsync(req);

        cardsResp.EnsureSuccessStatusCode();
        Assert.False(cardsResp.Headers.Contains("X-Consistency"));
        var card = (await cardsResp.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("cards").EnumerateArray()
            .Single(c => c.GetProperty("noteId").GetString() == noteId);
        // Unfiled, not still under the deleted folder.
        Assert.Equal(JsonValueKind.Null, card.GetProperty("folderId").ValueKind);
    }

    [Fact]
    public async Task DeleteFolder_WithNoContainedNotes_OmitsTheNoteCardsToken()
    {
        var folderId = await CreateFolderAsync("Empty");

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();

        // Nothing was written to a note stream, so there is nothing for the cards read to wait on.
        Assert.False(deleteResp.Headers.Contains("X-Consistency-Token-Notes"));
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<string> CreateFolderAsync(string name)
    {
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("folderId").GetString()!;
    }

    private async Task<string> CreateNoteInFolderAsync(string folderId)
    {
        var createResp = await _client.PostAsync("/notes", new StringContent("null", Encoding.UTF8, "application/json"));
        createResp.EnsureSuccessStatusCode();
        var noteId = (await createResp.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        var moveResp = await _client.PutAsync($"/notes/{noteId}/folder",
            new StringContent($"{{\"folderId\":\"{folderId}\"}}", Encoding.UTF8, "application/json"));
        moveResp.EnsureSuccessStatusCode();
        return noteId;
    }
}
