using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

public sealed class GetNoteTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;
    private readonly HttpClient _client = factory.CreateClient();

    [Fact]
    public async Task GetNote_returns_200_with_noteId_title_content_and_timestamps()
    {
        var noteId = await CreateAndNameNoteAsync("Bill 1:1");

        var resp = await _client.GetAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(noteId, body.GetProperty("noteId").GetString());
        Assert.Equal("Bill 1:1", body.GetProperty("title").GetString());
        Assert.True(body.TryGetProperty("content", out _), "response must include content");
        Assert.True(body.TryGetProperty("createdAt", out _), "response must include createdAt");
        Assert.True(body.TryGetProperty("lastModifiedAt", out _), "response must include lastModifiedAt");
    }

    [Fact]
    public async Task GetNote_nonexistent_returns_404()
    {
        var resp = await _client.GetAsync($"/notes/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
    }

    // BUG-31 layer 3: GetNote was silent, so a slow/missing note-detail read (which leaves the
    // Save button disabled and hangs the E2E save click ~30s) was invisible in prod. A hit logs
    // outcome + result=Hit + latency; an absent row logs result=Absent — together they tell a
    // lagging projector (Absent→Hit on retry) apart from a never-landed write (Absent persists).
    [Fact]
    public async Task GetNote_hit_logs_read_outcome_with_latency()
    {
        var captured = new CapturingLoggerProvider();
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddSingleton<ILoggerProvider>(captured))).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateAndNameNoteAsync("Bill 1:1", client);
        var resp = await client.GetAsync($"/notes/{noteId}");

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains(captured.Entries, e =>
            e.Message.Contains("NoteDetail read") &&
            e.Message.Contains(noteId) &&
            e.Message.Contains("result=Hit") &&
            e.Message.Contains("latencyMs="));
    }

    [Fact]
    public async Task GetNote_absent_logs_result_Absent()
    {
        var captured = new CapturingLoggerProvider();
        var client = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.AddSingleton<ILoggerProvider>(captured))).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var missingId = Guid.NewGuid();
        var resp = await client.GetAsync($"/notes/{missingId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Contains(captured.Entries, e =>
            e.Message.Contains("NoteDetail read") &&
            e.Message.Contains(missingId.ToString()) &&
            e.Message.Contains("result=Absent") &&
            e.Message.Contains("latencyMs="));
    }

    private async Task<string> CreateAndNameNoteAsync(string title)
        => await CreateAndNameNoteAsync(title, _client);

    private static async Task<string> CreateAndNameNoteAsync(string title, HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString()!;
        await client.PatchAsync($"/notes/{noteId}/title",
            new StringContent($"{{\"title\":\"{title}\"}}", Encoding.UTF8, "application/json"));
        return noteId;
    }
}
