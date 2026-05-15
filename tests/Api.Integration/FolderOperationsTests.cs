using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace Api.Integration;

public sealed class RenameFolderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PatchFolderName_RenamesFolder()
    {
        var folderId = await CreateFolderAsync("Peopl");
        var resp = await PatchNameAsync(folderId, "People");
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var folders = await GetFlatFoldersAsync();
        var folder = folders.First(f => f.GetProperty("folderId").GetString() == folderId);
        Assert.Equal("People", folder.GetProperty("name").GetString());
    }

    [Fact]
    public async Task PatchFolderName_EmptyName_ReturnsBadRequest()
    {
        var folderId = await CreateFolderAsync("People");
        var resp = await PatchNameAsync(folderId, "");
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PatchFolderName_NonExistentFolder_ReturnsNotFound()
    {
        var resp = await PatchNameAsync(Guid.NewGuid().ToString(), "NewName");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateFolderAsync(string name)
    {
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private Task<HttpResponseMessage> PatchNameAsync(string folderId, string name) =>
        _client.PatchAsync($"/folders/{folderId}/name",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));

    private async Task<List<JsonElement>> GetFlatFoldersAsync()
    {
        var resp = await _client.GetAsync("/folders");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        var result = new List<JsonElement>();
        FlattenFolders(body.GetProperty("folders"), result);
        return result;
    }

    private static void FlattenFolders(JsonElement folders, List<JsonElement> result)
    {
        foreach (var f in folders.EnumerateArray())
        {
            result.Add(f);
            if (f.TryGetProperty("children", out var children))
                FlattenFolders(children, result);
        }
    }
}

public sealed class DeleteFolderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task DeleteFolder_RemovesFolderFromTree()
    {
        var folderId = await CreateFolderAsync("People");
        var resp = await _client.DeleteAsync($"/folders/{folderId}");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var getResp = await _client.GetAsync("/folders");
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var ids = body.GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString()).ToList();
        Assert.DoesNotContain(folderId, ids);
    }

    [Fact]
    public async Task DeleteFolder_WithChildren_CascadesAndRemovesAll()
    {
        var parentId = await CreateFolderAsync("People");
        var childId = await CreateFolderAsync("Bill", parentId);

        var resp = await _client.DeleteAsync($"/folders/{parentId}");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var getResp = await _client.GetAsync("/folders");
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var allFolders = new List<JsonElement>();
        FlattenFolders(body.GetProperty("folders"), allFolders);
        var ids = allFolders.Select(f => f.GetProperty("folderId").GetString()).ToList();
        Assert.DoesNotContain(parentId, ids);
        Assert.DoesNotContain(childId, ids);
    }

    [Fact]
    public async Task DeleteFolder_WithFiledNote_UnfilesNoteAfterDelete()
    {
        var folderId = await CreateFolderAsync("People");
        var noteId = await CreateNoteAsync();
        await PutAsync($"/notes/{noteId}/folder", $"{{\"folderId\":\"{folderId}\"}}");

        await _client.DeleteAsync($"/folders/{folderId}");

        var card = await GetCardAsync(noteId);
        Assert.True(card.GetProperty("folderId").ValueKind == JsonValueKind.Null
            || !card.TryGetProperty("folderId", out var fi) || fi.ValueKind == JsonValueKind.Null);
    }

    [Fact]
    public async Task DeleteFolder_NonExistent_ReturnsNotFound()
    {
        var resp = await _client.DeleteAsync($"/folders/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateFolderAsync(string name, string? parentId = null)
    {
        var payload = parentId is null
            ? $"{{\"name\":\"{name}\"}}"
            : $"{{\"name\":\"{name}\",\"parentFolderId\":\"{parentId}\"}}";
        var resp = await _client.PostAsync("/folders",
            new StringContent(payload, Encoding.UTF8, "application/json"));
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task<HttpResponseMessage> PutAsync(string url, string json) =>
        _client.PutAsync(url, new StringContent(json, Encoding.UTF8, "application/json"));

    private async Task<JsonElement> GetCardAsync(string noteId)
    {
        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
    }

    private static void FlattenFolders(JsonElement folders, List<JsonElement> result)
    {
        foreach (var f in folders.EnumerateArray())
        {
            result.Add(f);
            if (f.TryGetProperty("children", out var children))
                FlattenFolders(children, result);
        }
    }
}

public sealed class MoveFolderTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PutFolderParent_ReparentsFolderInTree()
    {
        var peopleId = await CreateFolderAsync("People");
        var billId = await CreateFolderAsync("Bill");

        var resp = await PutParentAsync(billId, peopleId);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var getResp = await _client.GetAsync("/folders");
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var rootIds = body.GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString()).ToList();
        Assert.DoesNotContain(billId, rootIds);

        var people = body.GetProperty("folders").EnumerateArray()
            .First(f => f.GetProperty("folderId").GetString() == peopleId);
        var childIds = people.GetProperty("children").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString()).ToList();
        Assert.Contains(billId, childIds);
    }

    [Fact]
    public async Task PutFolderParent_MoveToRoot_RemovesFromParent()
    {
        var peopleId = await CreateFolderAsync("People");
        var billId = await CreateFolderAsync("Bill", peopleId);

        var resp = await _client.PutAsync($"/folders/{billId}/parent",
            new StringContent("{\"parentFolderId\":null}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);

        var getResp = await _client.GetAsync("/folders");
        var body = await getResp.Content.ReadFromJsonAsync<JsonElement>();
        var rootIds = body.GetProperty("folders").EnumerateArray()
            .Select(f => f.GetProperty("folderId").GetString()).ToList();
        Assert.Contains(billId, rootIds);
    }

    [Fact]
    public async Task PutFolderParent_CycleDetected_ReturnsBadRequest()
    {
        var peopleId = await CreateFolderAsync("People");
        var billId = await CreateFolderAsync("Bill", peopleId);

        // Try to make People a child of Bill (cycle)
        var resp = await PutParentAsync(peopleId, billId);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PutFolderParent_FolderIntoItself_ReturnsBadRequest()
    {
        var peopleId = await CreateFolderAsync("People");
        var resp = await PutParentAsync(peopleId, peopleId);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    private async Task<string> CreateFolderAsync(string name, string? parentId = null)
    {
        var payload = parentId is null
            ? $"{{\"name\":\"{name}\"}}"
            : $"{{\"name\":\"{name}\",\"parentFolderId\":\"{parentId}\"}}";
        var resp = await _client.PostAsync("/folders",
            new StringContent(payload, Encoding.UTF8, "application/json"));
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private Task<HttpResponseMessage> PutParentAsync(string folderId, string parentFolderId) =>
        _client.PutAsync($"/folders/{folderId}/parent",
            new StringContent($"{{\"parentFolderId\":\"{parentFolderId}\"}}", Encoding.UTF8, "application/json"));
}

public sealed class NoteFilingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task PutNoteFolder_FilesNoteInFolder_CardShowsFolderId()
    {
        var noteId = await CreateNoteAsync();
        var folderId = await CreateFolderAsync("Projects");

        var resp = await _client.PutAsync($"/notes/{noteId}/folder",
            new StringContent($"{{\"folderId\":\"{folderId}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var card = await GetCardAsync(noteId);
        Assert.Equal(folderId, card.GetProperty("folderId").GetString());
    }

    [Fact]
    public async Task DeleteNoteFolder_UnfilesNote_CardFolderIdNull()
    {
        var noteId = await CreateNoteAsync();
        var folderId = await CreateFolderAsync("Projects");
        await _client.PutAsync($"/notes/{noteId}/folder",
            new StringContent($"{{\"folderId\":\"{folderId}\"}}", Encoding.UTF8, "application/json"));

        var resp = await _client.DeleteAsync($"/notes/{noteId}/folder");
        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);

        var card = await GetCardAsync(noteId);
        var folderProp = card.GetProperty("folderId");
        Assert.Equal(JsonValueKind.Null, folderProp.ValueKind);
    }

    [Fact]
    public async Task GetNoteCards_IncludesFolderIdField()
    {
        var noteId = await CreateNoteAsync();
        var folderId = await CreateFolderAsync("Projects");
        await _client.PutAsync($"/notes/{noteId}/folder",
            new StringContent($"{{\"folderId\":\"{folderId}\"}}", Encoding.UTF8, "application/json"));

        var card = await GetCardAsync(noteId);
        Assert.True(card.TryGetProperty("folderId", out _), "Card should have folderId field");
    }

    [Fact]
    public async Task GetNoteCards_UnfiledNote_FolderIdIsNull()
    {
        var noteId = await CreateNoteAsync();

        var card = await GetCardAsync(noteId);
        Assert.True(card.TryGetProperty("folderId", out var fi), "Card should have folderId field");
        Assert.Equal(JsonValueKind.Null, fi.ValueKind);
    }

    [Fact]
    public async Task PutNoteFolder_NonExistentNote_ReturnsNotFound()
    {
        var folderId = await CreateFolderAsync("Projects");
        var resp = await _client.PutAsync($"/notes/{Guid.NewGuid()}/folder",
            new StringContent($"{{\"folderId\":\"{folderId}\"}}", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task DeleteNoteFolder_NonExistentNote_ReturnsNotFound()
    {
        var resp = await _client.DeleteAsync($"/notes/{Guid.NewGuid()}/folder");
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private async Task<string> CreateFolderAsync(string name)
    {
        var resp = await _client.PostAsync("/folders",
            new StringContent($"{{\"name\":\"{name}\"}}", Encoding.UTF8, "application/json"));
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("folderId").GetString()!;
    }

    private async Task<JsonElement> GetCardAsync(string noteId)
    {
        var resp = await _client.GetAsync("/notes/cards");
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("cards").EnumerateArray()
            .First(c => c.GetProperty("noteId").GetString() == noteId);
    }
}
