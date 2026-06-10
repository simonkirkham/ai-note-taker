using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Api.Integration;

public sealed class NoteImageLifecycleTests : IClassFixture<ApiFactory>
{
    private readonly HttpClient _client;
    private readonly FakeNoteImageStore _images;
    private readonly FakeBedrockAnalysisService _bedrock;

    public NoteImageLifecycleTests(ApiFactory factory)
    {
        _client = factory.CreateClient();
        _images = factory.Services.GetRequiredService<FakeNoteImageStore>();
        _bedrock = factory.Services.GetRequiredService<FakeBedrockAnalysisService>();
        _bedrock.NextResult = new NoteAnalysisResult("", [], [], [], []);
    }

    private async Task<string> CreateNoteAsync()
    {
        var resp = await _client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private Task SetContentAsync(string noteId, string content) =>
        _client.PutAsJsonAsync($"/notes/{noteId}/content", new { content });

    [Fact]
    public async Task DeletingNote_PurgesItsImagePrefix()
    {
        var noteId = await CreateNoteAsync();

        var resp = await _client.DeleteAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Contains(noteId, _images.PurgedNoteIds);
    }

    [Fact]
    public async Task DeletingNote_WhenPurgeFails_StillReturns204()
    {
        var noteId = await CreateNoteAsync();
        _images.PurgeThrows = true;
        try
        {
            var resp = await _client.DeleteAsync($"/notes/{noteId}");
            Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        }
        finally
        {
            _images.PurgeThrows = false;
        }
    }

    [Fact]
    public async Task Analyse_StripsImageMarkdownFromContentSentToModel()
    {
        var noteId = await CreateNoteAsync();
        await SetContentAsync(noteId, "Whiteboard: ![diagram](notes/abc/img1.png) and next steps.");

        var resp = await _client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.NotNull(_bedrock.LastRequest);
        Assert.DoesNotContain("![", _bedrock.LastRequest!.ExistingContent);
        Assert.DoesNotContain("notes/abc/img1.png", _bedrock.LastRequest.ExistingContent);
        Assert.Contains("Whiteboard:", _bedrock.LastRequest.ExistingContent);
        Assert.Contains("next steps.", _bedrock.LastRequest.ExistingContent);
    }
}
