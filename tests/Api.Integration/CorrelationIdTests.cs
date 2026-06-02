using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using EventStore.Projections;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

public sealed class CorrelationIdTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string CorrelationIdHeader = "x-correlation-id";
    private const string TraceIdHeader = "x-amzn-trace-id";

    [Fact]
    public async Task SuccessfulResponse_CarriesCorrelationIdHeader()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(CorrelationIdHeader, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task SuccessfulResponse_CarriesTraceIdHeader()
    {
        var client = factory.CreateClient();

        var resp = await client.GetAsync("/health");

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(TraceIdHeader, out var values));
        Assert.False(string.IsNullOrWhiteSpace(values!.Single()));
    }

    [Fact]
    public async Task Response_EchoesInboundTraceId()
    {
        var client = factory.CreateClient();
        const string inbound = "Root=1-5e1b4151-5ac6c58dc39a6e8d5e3a1234";

        var request = new HttpRequestMessage(HttpMethod.Get, "/health");
        request.Headers.Add(TraceIdHeader, inbound);
        var resp = await client.SendAsync(request);

        resp.EnsureSuccessStatusCode();
        Assert.True(resp.Headers.TryGetValues(TraceIdHeader, out var values));
        Assert.Equal(inbound, values!.Single());
    }

    [Fact]
    public async Task UnhandledException_Returns500_WithCorrelationIdInHeaderAndBody()
    {
        // Swap in a projection store that throws so GET /notes surfaces an
        // unhandled exception, exercising the global 500 handler.
        var client = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<INoteTitleListStore>();
                services.AddSingleton<INoteTitleListStore, ThrowingNoteTitleListStore>();
            })).CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var resp = await client.GetAsync("/notes");

        Assert.Equal(HttpStatusCode.InternalServerError, resp.StatusCode);
        Assert.True(resp.Headers.TryGetValues(CorrelationIdHeader, out var headerValues));
        var correlationId = headerValues!.Single();
        Assert.False(string.IsNullOrWhiteSpace(correlationId));

        var body = await resp.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(correlationId, body.GetProperty("correlationId").GetString());
    }
}
