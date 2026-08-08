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

        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-NoteCards"));
        var (stream, version) = ParseToken(notesToken);
        Assert.Equal($"note#{noteId}", stream);
        Assert.True(version >= 1, $"expected a positive version, got {version}");

        // The folder-tree token is unchanged — both scopes are gated, not one at the other's cost.
        var folderToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token"));
        Assert.Equal($"folder-{Guid.Parse(folderId):N}", ParseToken(folderToken).Stream);
    }

    // NOTE: a smoke check that the gate ACCEPTS the token without erroring — not proof that it
    // waits. ApiFactory wires SyncProjectingEventStore + InMemoryProcessedPositionStore, so
    // projections apply on append and the gate is Fresh on the first poll: the note is unfiled here
    // whether or not the token is sent, and this test passes with the whole fix reverted. Same
    // harness limitation the BUG-50 entry records. The header-identity tests are the real proof.
    [Fact]
    public async Task DeleteFolder_NoteCardsGatedOnThatToken_IsAcceptedAndShowsTheNoteUnfiled()
    {
        var folderId = await CreateFolderAsync("Doomed");
        var noteId = await CreateNoteInFolderAsync(folderId);

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();
        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-NoteCards"));

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
        Assert.False(deleteResp.Headers.Contains("X-Consistency-Token-NoteCards"));
    }

    private static (string Stream, long Version) ParseToken(string token)
    {
        var at = token.LastIndexOf('@');
        return (token[..at], long.Parse(token[(at + 1)..]));
    }

    private async Task<string> CreateFolderAsync(string name, string? parentFolderId = null)
    {
        var parent = parentFolderId is null ? "null" : $"\"{parentFolderId}\"";
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\",\"parentFolderId\":{parent}}}", Encoding.UTF8, "application/json"));
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

    // The cross-folder accumulator (`?? noteCardsToken`) — the only genuinely new logic here, and
    // untested until now (Hawk, PR #437). The notes live in a DESCENDANT folder while the target
    // folder itself is empty, so the last iteration contributes nothing and the token must survive
    // from the earlier one. The plausible inversion — `noteCardsToken ?? await Unfile(...)`,
    // short-circuiting after the first hit — passes every other test in this file.
    [Fact]
    public async Task DeleteFolder_NotesOnlyInAChildFolder_StillReturnsTheNoteCardsToken()
    {
        var parentId = await CreateFolderAsync("Parent");
        var childId = await CreateFolderAsync("Child", parentId);
        var noteId = await CreateNoteInFolderAsync(childId);

        var deleteResp = await _client.DeleteAsync($"/folders/{parentId}");
        deleteResp.EnsureSuccessStatusCode();

        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-NoteCards"));
        Assert.Equal($"note#{noteId}", ParseToken(notesToken).Stream);
    }

    // The cross-folder accumulator (`?? noteCardsToken`) — the only genuinely new logic here.
    // TWO folders must each contribute a token or the test cannot discriminate: with a single
    // non-empty folder, `new ?? acc` and the inverted `acc ?? new` both end up holding that one
    // token. The subtree is iterated bottom-up then the target last, so the correct form (keep the
    // LAST) yields the PARENT's note; the inversion (keep the first, short-circuiting) yields the
    // child's. One note per folder, so the arbitrary scan order within a folder can't confound it.
    [Fact]
    public async Task DeleteFolder_NotesInBothChildAndParent_KeepsTheLastCascadeToken()
    {
        var parentId = await CreateFolderAsync("Parent");
        var childId = await CreateFolderAsync("Child", parentId);
        var childNoteId = await CreateNoteInFolderAsync(childId);
        var parentNoteId = await CreateNoteInFolderAsync(parentId);

        var deleteResp = await _client.DeleteAsync($"/folders/{parentId}");
        deleteResp.EnsureSuccessStatusCode();

        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-NoteCards"));
        var stream = ParseToken(notesToken).Stream;
        Assert.Equal($"note#{parentNoteId}", stream);
        Assert.NotEqual($"note#{childNoteId}", stream);
    }

    // With more than one note the cascade writes N note streams and the cards gate can hold only
    // one token (design decision #7). WHICH one is not controllable: the notes are iterated in the
    // projection SCAN's order, not creation order, so "the last unfile write" is the last appended
    // in an arbitrary order. What must hold is that the token names one of the streams this cascade
    // actually wrote — never a stale/unrelated one, and never absent.
    [Fact]
    public async Task DeleteFolder_WithTwoNotes_ReturnsATokenForOneOfTheUnfiledStreams()
    {
        var folderId = await CreateFolderAsync("Two notes");
        var firstNoteId = await CreateNoteInFolderAsync(folderId);
        var secondNoteId = await CreateNoteInFolderAsync(folderId);

        var deleteResp = await _client.DeleteAsync($"/folders/{folderId}");
        deleteResp.EnsureSuccessStatusCode();

        var notesToken = Assert.Single(deleteResp.Headers.GetValues("X-Consistency-Token-NoteCards"));
        var stream = ParseToken(notesToken).Stream;
        Assert.Contains(stream, new[] { $"note#{firstNoteId}", $"note#{secondNoteId}" });
    }
}
