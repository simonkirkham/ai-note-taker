using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Api.Integration;

public class NoteRecordingsIntegrationTests : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory;
    private readonly HttpClient _client;

    public NoteRecordingsIntegrationTests(ApiFactory factory)
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
    public async Task PresignUpload_Owner_Returns200WithKeyUnderRecordingsAndUrl()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/recording/presign-upload",
            new { contentType = "audio/wav", contentLength = 4096 });

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.StartsWith($"recordings/{noteId}/", body.GetProperty("key").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("uploadUrl").GetString()));
    }

    [Fact]
    public async Task PresignUpload_DisallowedContentType_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/recording/presign-upload",
            new { contentType = "image/png", contentLength = 4096 });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PresignUpload_ZeroContentLength_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/recording/presign-upload",
            new { contentType = "audio/wav", contentLength = 0 });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task PresignUpload_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsJsonAsync($"/notes/{noteId}/recording/presign-upload",
            new { contentType = "audio/wav", contentLength = 4096 });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task SaveRecording_Owner_PersistsKeyOnNoteDetail()
    {
        var noteId = await CreateNoteAsync();
        var key = $"recordings/{noteId}/take.wav";

        var save = await _client.PostAsJsonAsync($"/notes/{noteId}/recording", new { key });
        Assert.Equal(HttpStatusCode.NoContent, save.StatusCode);

        var get = await _client.GetAsync($"/notes/{noteId}");
        var body = await get.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(key, body.GetProperty("recordingAudioKey").GetString());
    }

    [Fact]
    public async Task SaveRecording_KeyOutsideNotePrefix_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var save = await _client.PostAsJsonAsync($"/notes/{noteId}/recording",
            new { key = "recordings/some-other-note/take.wav" });

        Assert.Equal(HttpStatusCode.BadRequest, save.StatusCode);
    }

    [Fact]
    public async Task SaveRecording_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var save = await other.PostAsJsonAsync($"/notes/{noteId}/recording",
            new { key = $"recordings/{noteId}/take.wav" });

        Assert.Equal(HttpStatusCode.NotFound, save.StatusCode);
    }

    [Fact]
    public async Task PresignDownload_AfterSave_Returns200WithUrl()
    {
        var noteId = await CreateNoteAsync();
        var key = $"recordings/{noteId}/take.wav";
        await _client.PostAsJsonAsync($"/notes/{noteId}/recording", new { key });

        var resp = await _client.PostAsync($"/notes/{noteId}/recording/presign-download", null);
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("downloadUrl").GetString()));
    }

    [Fact]
    public async Task PresignDownload_NoRecording_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsync($"/notes/{noteId}/recording/presign-download", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task PresignDownload_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        await _client.PostAsJsonAsync($"/notes/{noteId}/recording", new { key = $"recordings/{noteId}/take.wav" });
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsync($"/notes/{noteId}/recording/presign-download", null);
        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    [Fact]
    public async Task Diarize_Owner_Returns202AndStartsJobEncodingNoteId()
    {
        var noteId = await CreateNoteAsync();
        var key = $"recordings/{noteId}/take.wav";

        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/transcription/diarize", new { key });
        Assert.Equal(HttpStatusCode.Accepted, resp.StatusCode);

        var starter = _factory.Services.GetRequiredService<FakeTranscriptionJobStarter>();
        var started = Assert.Single(starter.Started, s => s.AudioKey == key);
        Assert.True(DiarizationJobNames.TryGetNoteId(started.JobName, out var recovered));
        Assert.Equal(noteId, recovered);
    }

    [Fact]
    public async Task Diarize_KeyOutsideNotePrefix_Returns400()
    {
        var noteId = await CreateNoteAsync();
        var resp = await _client.PostAsJsonAsync($"/notes/{noteId}/transcription/diarize",
            new { key = "recordings/some-other-note/take.wav" });

        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
    }

    [Fact]
    public async Task Diarize_NonOwner_Returns404()
    {
        var noteId = await CreateNoteAsync();
        var other = _factory.CreateClientAsOtherUser();
        var resp = await other.PostAsJsonAsync($"/notes/{noteId}/transcription/diarize",
            new { key = $"recordings/{noteId}/take.wav" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }
}
