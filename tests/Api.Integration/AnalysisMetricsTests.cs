using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Api.Observability;
using Api.Services;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// CHANGE-22: analysis timing + per-note failure observability.
public sealed class AnalysisMetricsTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private async Task<string> CreateNoteWithTranscriptAsync(HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        var noteId = body.GetProperty("noteId").GetString()!;
        var resp = await client.PostAsync($"/notes/{noteId}/transcription",
            new StringContent(JsonSerializer.Serialize(new { transcriptText = "We agreed to ship Friday.", durationSeconds = 5 }),
                Encoding.UTF8, "application/json"));
        resp.EnsureSuccessStatusCode();
        return noteId;
    }

    [Fact]
    public async Task SuccessfulAnalysis_RecordsAnalysisDuration()
    {
        var metrics = new RecordingDomainMetrics();
        var built = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
            }));
        var client = built.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        built.Services.GetRequiredService<FakeBedrockAnalysisService>().NextResult =
            new NoteAnalysisResult("A summary.", [], [], [], [], "amazon.nova-lite-v1:0", "analysis@v8");

        var noteId = await CreateNoteWithTranscriptAsync(client);
        var resp = await client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Single(metrics.AnalysisDurations);
        Assert.True(metrics.AnalysisDurations[0] >= 0);
        Assert.Equal(0, metrics.AnalysisFailures);
    }

    [Fact]
    public async Task FailedAnalysis_RecordsAnalysisFailed_NotDuration()
    {
        var metrics = new RecordingDomainMetrics();
        var built = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
                services.RemoveAll<IBedrockAnalysisService>();
                services.AddSingleton<IBedrockAnalysisService, ThrowingBedrockAnalysisService>();
            }));
        var client = built.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteWithTranscriptAsync(client);
        var resp = await client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        Assert.Equal(1, metrics.AnalysisFailures);
        Assert.Empty(metrics.AnalysisDurations);
    }

    // BUG-58: a Bedrock call that outlives its deadline used to kill the Lambda mid-flight — no
    // response, no metric, no log line. It must now land on the same visible failure path as any
    // other Bedrock error: 503 to the user, AnalysisFailed metric, and an Error log naming the note.
    [Fact]
    public async Task AnalysisThatExceedsTheDeadline_Returns503_RecordsFailure_AndLogsAnError()
    {
        var metrics = new RecordingDomainMetrics();
        var logs = new CapturingLoggerProvider();
        var built = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
                services.RemoveAll<IBedrockAnalysisService>();
                services.AddSingleton<IBedrockAnalysisService, TimingOutBedrockAnalysisService>();
                services.AddSingleton<ILoggerProvider>(logs);
            }));
        var client = built.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var noteId = await CreateNoteWithTranscriptAsync(client);
        var resp = await client.PostAsync($"/notes/{noteId}/analyse", null);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
        Assert.Equal(1, metrics.AnalysisFailures);
        Assert.Empty(metrics.AnalysisDurations);
        Assert.Contains(logs.Entries, e =>
            e.Level == LogLevel.Error && e.Message.Contains("Analysis failed") && e.Message.Contains(noteId));
    }
}
