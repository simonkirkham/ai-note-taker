using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace Api.Integration;

// BUG-41: object-level authorization (IDOR) on the HTTP action-item mutation endpoints. Owning ANY
// note + knowing a foreign actionId must NOT let you mutate that action. The exploit: user B creates
// their OWN note (so the route-noteId ownership check passes), then targets user A's actionId. The fix
// binds authorization to the action's own stamped owner (IActionItemAuthorizer.OwnsActionAsync), the
// same rule the MCP action-item tools already enforce (McpActionItemWriteToolsTests). A foreign action
// returns 404 (does not leak existence) and the action stays unchanged.
public sealed class ActionItemAuthorizationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task Complete_OnAnotherUsersAction_Returns404AndDoesNotChangeIt()
    {
        var owner = _factory.CreateClient();
        var intruder = _factory.CreateClientAsOtherUser();
        var (ownerNoteId, actionId) = await CreateNoteWithActionAsync(owner);
        var intruderNoteId = await CreateNoteAsync(intruder);

        var resp = await intruder.PostAsync($"/notes/{intruderNoteId}/actions/{actionId}/complete", null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var action = await ActionAsync(owner, ownerNoteId, actionId);
        Assert.False(action.GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task Reopen_OnAnotherUsersAction_Returns404AndDoesNotChangeIt()
    {
        var owner = _factory.CreateClient();
        var intruder = _factory.CreateClientAsOtherUser();
        var (ownerNoteId, actionId) = await CreateNoteWithActionAsync(owner);
        await owner.PostAsync($"/notes/{ownerNoteId}/actions/{actionId}/complete", null);
        var intruderNoteId = await CreateNoteAsync(intruder);

        var resp = await intruder.PostAsync($"/notes/{intruderNoteId}/actions/{actionId}/reopen", null);

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var action = await ActionAsync(owner, ownerNoteId, actionId);
        Assert.True(action.GetProperty("completed").GetBoolean());
    }

    [Fact]
    public async Task Edit_OnAnotherUsersAction_Returns404AndDoesNotChangeIt()
    {
        var owner = _factory.CreateClient();
        var intruder = _factory.CreateClientAsOtherUser();
        var (ownerNoteId, actionId) = await CreateNoteWithActionAsync(owner);
        var intruderNoteId = await CreateNoteAsync(intruder);

        var resp = await intruder.PutAsJsonAsync(
            $"/notes/{intruderNoteId}/actions/{actionId}", new { description = "hijacked" });

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var action = await ActionAsync(owner, ownerNoteId, actionId);
        Assert.Equal("Chase invoice", action.GetProperty("description").GetString());
    }

    [Fact]
    public async Task Delete_OnAnotherUsersAction_Returns404AndDoesNotRemoveIt()
    {
        var owner = _factory.CreateClient();
        var intruder = _factory.CreateClientAsOtherUser();
        var (ownerNoteId, actionId) = await CreateNoteWithActionAsync(owner);
        var intruderNoteId = await CreateNoteAsync(intruder);

        var resp = await intruder.DeleteAsync($"/notes/{intruderNoteId}/actions/{actionId}");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        var action = await ActionAsync(owner, ownerNoteId, actionId);
        Assert.Equal("Chase invoice", action.GetProperty("description").GetString());
    }

    [Fact]
    public async Task Complete_OnOwnAction_StillSucceeds()
    {
        var owner = _factory.CreateClient();
        var (noteId, actionId) = await CreateNoteWithActionAsync(owner);

        var resp = await owner.PostAsync($"/notes/{noteId}/actions/{actionId}/complete", null);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var action = await ActionAsync(owner, noteId, actionId);
        Assert.True(action.GetProperty("completed").GetBoolean());
    }

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var resp = await client.PostAsync("/notes", null);
        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private static async Task<(string noteId, Guid actionId)> CreateNoteWithActionAsync(HttpClient client)
    {
        var noteId = await CreateNoteAsync(client);
        var actionResp = await client.PostAsJsonAsync($"/notes/{noteId}/actions", new { description = "Chase invoice" });
        var actionBody = await actionResp.Content.ReadFromJsonAsync<JsonElement>();
        var actionId = Guid.Parse(actionBody.GetProperty("actionId").GetString()!);
        return (noteId, actionId);
    }

    // Reads one action under the owner's note, fetched as the owner (proving the intruder's call
    // neither mutated nor removed it).
    private static async Task<JsonElement> ActionAsync(HttpClient ownerClient, string noteId, Guid actionId)
    {
        var actions = await ownerClient.GetFromJsonAsync<JsonElement>($"/notes/{noteId}/actions");
        return actions.GetProperty("actions").EnumerateArray()
            .Single(a => Guid.Parse(a.GetProperty("actionId").GetString()!) == actionId)
            .Clone();
    }
}
