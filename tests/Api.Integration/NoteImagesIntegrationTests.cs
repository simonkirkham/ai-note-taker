using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Api.Integration;

public class NoteImagesIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public NoteImagesIntegrationTests(ApiFactory factory)
    {
        _factory = factory;
        _client = factory.CreateClient();
    }

    private async Task<string> CreateNoteAsync()
    {
        var create = await _client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    [Fact]
    public async Task PresignUpload_OwnerAllowedType_Returns200WithKeyUnderNoteAndUrl()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/images/presign-upload",
            new { contentType = "image/png", contentLength = 1024 });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith($"notes/{noteId}/", body.GetProperty("key").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("uploadUrl").GetString()));
        Assert.False(string.IsNullOrEmpty(body.GetProperty("imageId").GetString()));
    }

    [Fact]
    public async Task PresignUpload_DisallowedContentType_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/images/presign-upload",
            new { contentType = "application/pdf", contentLength = 1024 });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PresignUpload_OverSizeCap_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/images/presign-upload",
            new { contentType = "image/png", contentLength = 11L * 1024 * 1024 });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PresignUpload_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsJsonAsync($"/notes/{noteId}/images/presign-upload",
            new { contentType = "image/png", contentLength = 1024 });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Resolve_OwnerInPrefixKeys_Returns200WithUrlPerKey()
    {
        var noteId = await CreateNoteAsync();
        var key = $"notes/{noteId}/abc123.png";
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/images/resolve",
            new { keys = new[] { key } });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("urls").GetProperty(key).GetString()));
    }

    [Fact]
    public async Task Resolve_KeyOutsideNotePrefix_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/images/resolve",
            new { keys = new[] { "notes/some-other-note/x.png" } });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Resolve_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsJsonAsync($"/notes/{noteId}/images/resolve",
            new { keys = new[] { $"notes/{noteId}/x.png" } });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
