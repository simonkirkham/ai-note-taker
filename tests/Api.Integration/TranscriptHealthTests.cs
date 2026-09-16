using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Api.Observability;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// TI-99: every transcript save carries how the live transcription was doing, so an incomplete
// transcript is diagnosable from the server alone — one log line, a coverage metric, a stall metric.
public sealed class TranscriptHealthTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string TranscriptMarker = "Speaker 1: the secret budget figure is forty two";

    private sealed record Harness(HttpClient Client, RecordingDomainMetrics Metrics, CapturingLoggerProvider Logs)
    {
        public IReadOnlyList<CapturedLog> HealthLines =>
            Logs.Entries.Where(e => e.Message.StartsWith("Transcript health", StringComparison.Ordinal)).ToList();
    }

    private Harness Build()
    {
        var metrics = new RecordingDomainMetrics();
        var logs = new CapturingLoggerProvider();
        var built = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton<IDomainMetrics>(metrics);
                services.AddSingleton<ILoggerProvider>(logs);
            }));
        var client = built.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        return new Harness(client, metrics, logs);
    }

    private static async Task<string> CreateNoteAsync(HttpClient client)
    {
        var create = await client.PostAsync("/notes", null);
        var body = await create.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("noteId").GetString()!;
    }

    private static Task<HttpResponseMessage> CompleteAsync(HttpClient client, string noteId, int duration, object? health) =>
        client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = TranscriptMarker, durationSeconds = duration, health }));

    private static Task<HttpResponseMessage> DraftAsync(HttpClient client, string noteId, int duration, object? health) =>
        client.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = TranscriptMarker, durationSeconds = duration, health }));

    private static object ErroredStream() => new
    {
        engine = "cloud",
        endReason = "error",
        errorName = "BadRequestException",
        errorMessage = "Your request timed out because no new audio was received for 15 seconds.",
        coveredSeconds = 2040.4,
        secondsSinceLastText = 3100,
        audioSecondsSent = 2045,
        secondsSinceLastAudio = 3050,
        streamCount = 1,
    };

    [Fact]
    public async Task Given_a_long_recording_whose_stream_errored_When_completed_Then_a_warning_names_the_reason_and_the_coverage()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await CompleteAsync(h.Client, noteId, 5302, ErroredStream());

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains($"Transcript health complete note {noteId}: end=error", line.Message);
        Assert.Contains("covered=2040.4s of 5302s ratio=0.38", line.Message);
        Assert.Contains("sinceLastText=3100s audioSent=2045s sinceLastAudio=3050s streams=1 engine=cloud", line.Message);
        Assert.Contains("error=BadRequestException: Your request timed out", line.Message);
        var ratio = Assert.Single(h.Metrics.TranscriptCoverages);
        Assert.InRange(ratio, 0.38, 0.39);
    }

    [Fact]
    public async Task Given_a_recording_stopped_by_the_user_with_full_coverage_When_completed_Then_it_logs_at_information_and_emits_coverage()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await CompleteAsync(h.Client, noteId, 600,
            new { engine = "cloud", endReason = "stopped", coveredSeconds = 590, secondsSinceLastText = 4, audioSecondsSent = 600, secondsSinceLastAudio = 0, streamCount = 1 });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("end=stopped", line.Message);
        var ratio = Assert.Single(h.Metrics.TranscriptCoverages);
        Assert.InRange(ratio, 0.98, 0.99);
    }

    [Fact]
    public async Task Given_a_long_recording_stopped_by_the_user_but_mostly_uncovered_When_completed_Then_it_warns()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 1000,
            new { engine = "cloud", endReason = "stopped", coveredSeconds = 400, streamCount = 1 });

        Assert.Equal(LogLevel.Warning, Assert.Single(h.HealthLines).Level);
    }

    [Fact]
    public async Task Given_a_stream_that_ended_on_its_own_When_completed_Then_it_warns()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 1000,
            new { engine = "cloud", endReason = "streamEnded", coveredSeconds = 990, streamCount = 1 });

        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("end=streamEnded", line.Message);
    }

    [Fact]
    public async Task Given_a_recording_under_five_minutes_When_completed_Then_no_coverage_metric_and_no_warning()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 299,
            new { engine = "cloud", endReason = "stopped", coveredSeconds = 10, streamCount = 1 });

        Assert.Empty(h.Metrics.TranscriptCoverages);
        Assert.Equal(LogLevel.Information, Assert.Single(h.HealthLines).Level);
    }

    [Fact]
    public async Task Given_an_engine_that_reports_no_coverage_When_completed_Then_no_coverage_metric()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 600, new { engine = "local", endReason = "stopped", streamCount = 1 });

        Assert.Empty(h.Metrics.TranscriptCoverages);
        var line = Assert.Single(h.HealthLines);
        Assert.Contains("engine=local", line.Message);
    }

    [Fact]
    public async Task Given_an_older_build_that_sends_no_health_When_completed_Then_it_still_saves_and_logs_absent()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await h.Client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = TranscriptMarker, durationSeconds = 600 }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Equal($"Transcript health complete note {noteId}: health: absent", line.Message);
        Assert.Empty(h.Metrics.TranscriptCoverages);
    }

    [Fact]
    public async Task Given_an_older_build_that_sends_no_health_When_a_draft_is_saved_Then_nothing_is_logged()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await h.Client.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = TranscriptMarker, durationSeconds = 60 }));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        Assert.Empty(h.HealthLines);
    }

    [Fact]
    public async Task Given_a_recording_in_progress_When_a_draft_is_saved_Then_it_logs_at_information_with_no_metrics()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 600,
            new { engine = "cloud", endReason = "inProgress", coveredSeconds = 590, secondsSinceLastText = 3, streamCount = 1 });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.StartsWith($"Transcript health draft note {noteId}: end=inProgress", line.Message);
        Assert.Empty(h.Metrics.TranscriptCoverages);
        Assert.Equal(0, h.Metrics.TranscriptStalls);
    }

    [Fact]
    public async Task Given_a_stalled_recording_When_a_draft_is_saved_Then_it_warns_and_counts_a_stall()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 900,
            new { engine = "cloud", endReason = "stalled", coveredSeconds = 700, secondsSinceLastText = 180, audioSecondsSent = 900, secondsSinceLastAudio = 0, streamCount = 1 });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("end=stalled", line.Message);
        Assert.Equal(1, h.Metrics.TranscriptStalls);
        Assert.Empty(h.Metrics.TranscriptCoverages);
    }

    [Fact]
    public async Task Given_an_errored_stream_When_a_draft_is_saved_Then_it_warns_but_counts_no_stall()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await DraftAsync(h.Client, noteId, 5302, ErroredStream());

        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Equal(0, h.Metrics.TranscriptStalls);
    }

    [Fact]
    public async Task Given_hostile_health_values_When_completed_Then_they_are_whitelisted_clamped_and_truncated()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);
        var longName = new string('n', 500);
        var longMessage = new string('m', 5000);

        var resp = await CompleteAsync(h.Client, noteId, 600, new
        {
            engine = "gpu-cluster",
            endReason = "<script>alert(1)</script>",
            errorName = longName,
            errorMessage = longMessage,
            coveredSeconds = 1e12,
            secondsSinceLastText = -50,
            audioSecondsSent = 9e9,
            secondsSinceLastAudio = -1,
            streamCount = -3,
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Contains("end=unknown", line.Message);
        Assert.Contains("engine=unknown", line.Message);
        Assert.DoesNotContain("<script>", line.Message);
        Assert.Contains("covered=86400s", line.Message);
        Assert.Contains("sinceLastText=0s", line.Message);
        Assert.Contains("audioSent=86400s", line.Message);
        Assert.Contains("streams=0", line.Message);
        Assert.Contains(new string('n', 200), line.Message);
        Assert.DoesNotContain(new string('n', 201), line.Message);
        Assert.Contains(new string('m', 200), line.Message);
        Assert.DoesNotContain(new string('m', 201), line.Message);
        Assert.Equal(1.0, Assert.Single(h.Metrics.TranscriptCoverages));
    }

    [Fact]
    public async Task Given_any_health_line_Then_the_transcript_text_is_never_logged()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await DraftAsync(h.Client, noteId, 900, new { endReason = "stalled", streamCount = 1 });
        await CompleteAsync(h.Client, noteId, 900, ErroredStream());

        Assert.Equal(2, h.HealthLines.Count);
        Assert.DoesNotContain(h.Logs.Entries, e => e.Message.Contains("secret budget"));
    }
}
