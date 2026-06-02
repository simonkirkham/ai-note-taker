using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Observability;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

public sealed class DomainMetricsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private (HttpClient Client, RecordingDomainMetrics Metrics) CreateClientWithMetrics()
    {
        var metrics = new RecordingDomainMetrics();
        var client = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
            })).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        return (client, metrics);
    }

    [Fact]
    public async Task SuccessfulCommand_RecordsCommandHandled()
    {
        var (client, metrics) = CreateClientWithMetrics();

        var resp = await client.PostAsync("/notes", null);

        Assert.Equal(HttpStatusCode.Created, resp.StatusCode);
        Assert.Contains(metrics.Handled, h => h.CommandType == "CreateNote" && h.Aggregate == "Note");
    }

    [Fact]
    public async Task DomainRuleViolation_RecordsCommandFailed_NotHandled()
    {
        var (client, metrics) = CreateClientWithMetrics();
        var create = await client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("noteId").GetString();

        // Re-creating the same note id violates a domain rule (note already exists).
        var duplicate = new StringContent($"{{\"noteId\":\"{noteId}\"}}", Encoding.UTF8, "application/json");
        var resp = await client.PostAsync("/notes", duplicate);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Contains(metrics.Failed, f => f.CommandType == "CreateNote" && f.ExceptionType == "InvalidOperationException");
    }
}
