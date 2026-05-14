using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit.Abstractions;

namespace Api.Smoke;

[Collection("Deployed API")]
public sealed class RenameNoteSpec(DeployedApiFixture fixture, ITestOutputHelper outputHelper)
{
    [Fact]
    public async Task PatchTitle_returns_200()
    {
        var noteId = await CreateNoteAsync();

        var body = new StringContent("{\"title\":\"My Note\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"notes/{noteId}/title", body);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task PatchTitle_noop_same_title_returns_200()
    {
        var noteId = await CreateNoteAsync();
        var body = new StringContent("{\"title\":\"Same Title\"}", Encoding.UTF8, "application/json");

        await fixture.Client.PatchAsync($"notes/{noteId}/title", body);
        var second = await fixture.Client.PatchAsync($"notes/{noteId}/title", body);

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
    }

    [Fact]
    public async Task PatchTitle_nonexistent_note_returns_404()
    {
        var body = new StringContent("{\"title\":\"Ghost\"}", Encoding.UTF8, "application/json");
        var response = await fixture.Client.PatchAsync($"notes/{Guid.NewGuid()}/title", body);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private async Task<string> CreateNoteAsync()
    {
        var response = await fixture.Client.PostAsync("notes", null);

        try
        {
            outputHelper.WriteLine($"Create note response code: {response.StatusCode}");
            var body = await response.Content.ReadFromJsonAsync<JsonElement>();
            return body.GetProperty("noteId").GetString()!;
        }
        catch (Exception ex)
        {
            outputHelper.WriteLine($"Error occurred while creating note: {ex.Message}, Response Code: {response.StatusCode}  ");
            throw;
        }
    }
}
