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

    private Harness Build(IDomainMetrics? metricsOverride = null)
    {
        var metrics = new RecordingDomainMetrics();
        var logs = new CapturingLoggerProvider();
        var built = factory.WithWebHostBuilder(b =>
            b.ConfigureTestServices(services =>
            {
                services.RemoveAll<IDomainMetrics>();
                services.AddSingleton(metricsOverride ?? metrics);
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

    private static Task<HttpResponseMessage> DraftAsync(HttpClient client, string noteId, int duration, object? health, string text = TranscriptMarker) =>
        client.PutAsync($"/notes/{noteId}/transcription/draft",
            JsonContent.Create(new { transcriptText = text, durationSeconds = duration, health }));

    private static async Task<JsonElement> GetNoteAsync(HttpClient client, string noteId)
    {
        var resp = await client.GetAsync($"/notes/{noteId}");
        resp.EnsureSuccessStatusCode();
        return await resp.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static string? DraftText(JsonElement note) =>
        note.TryGetProperty("transcriptDraft", out var d) && d.ValueKind == JsonValueKind.Object
            ? d.GetProperty("text").GetString()
            : null;

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

    // Review must-fix: a recording that has captured no text can still report a stall — the save
    // carries only the health block, and the recoverable draft is left exactly as it was.
    [Fact]
    public async Task Given_a_stall_with_no_text_captured_When_a_health_only_draft_is_saved_Then_it_reports_and_leaves_the_draft_alone()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);
        await DraftAsync(h.Client, noteId, 30, null, "Speaker 1: earlier words");

        var resp = await DraftAsync(h.Client, noteId, 300, new { engine = "cloud", endReason = "stalled", streamCount = 1 }, "");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("end=stalled", line.Message);
        Assert.Equal(1, h.Metrics.TranscriptStalls);
        Assert.Equal("Speaker 1: earlier words", DraftText(await GetNoteAsync(h.Client, noteId)));
    }

    [Fact]
    public async Task Given_a_stream_that_died_before_any_text_When_a_health_only_draft_is_saved_Then_the_error_is_logged()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 30,
            new { engine = "cloud", endReason = "error", errorName = "BadRequestException", errorMessage = "boom", streamCount = 1 }, "");

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("end=error", line.Message);
        Assert.Contains("error=BadRequestException: boom", line.Message);
        Assert.Equal(0, h.Metrics.TranscriptStalls);
        Assert.Null(DraftText(await GetNoteAsync(h.Client, noteId)));
    }

    [Fact]
    public async Task Given_empty_text_and_no_health_When_a_draft_is_saved_Then_it_is_still_rejected()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 30, null, "");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        Assert.Empty(h.HealthLines);
    }

    [Fact]
    public async Task Given_empty_text_with_health_When_completed_Then_it_is_still_rejected()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await h.Client.PostAsync($"/notes/{noteId}/transcription",
            JsonContent.Create(new { transcriptText = "", durationSeconds = 600, health = new { endReason = "stopped" } }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
    }

    [Fact]
    public async Task Given_someone_elses_note_When_a_health_only_draft_is_saved_Then_it_is_not_found_and_not_logged()
    {
        var h = Build();
        var resp = await DraftAsync(h.Client, Guid.NewGuid().ToString(), 300, new { endReason = "stalled" }, "");

        Assert.Equal(HttpStatusCode.NotFound, resp.StatusCode);
        Assert.Empty(h.HealthLines);
        Assert.Equal(0, h.Metrics.TranscriptStalls);
    }

    // Review should-fix: the save has already succeeded when health is reported, so a metrics
    // fault must never turn it into a 500.
    [Fact]
    public async Task Given_metrics_that_throw_When_saved_Then_the_save_still_succeeds()
    {
        var h = Build(new ThrowingTranscriptMetrics());
        var noteId = await CreateNoteAsync(h.Client);

        var draft = await DraftAsync(h.Client, noteId, 900, new { endReason = "stalled", streamCount = 1 });
        var complete = await CompleteAsync(h.Client, noteId, 900, ErroredStream());

        Assert.Equal(HttpStatusCode.NoContent, draft.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, complete.StatusCode);
    }

    public static TheoryData<string> MalformedHealth => new()
    {
        """{ "endReason": "stopped", "streamCount": 1.5 }""",
        """{ "endReason": 7, "streamCount": 1 }""",
        """{ "endReason": "stopped", "coveredSeconds": "NaN", "secondsSinceLastText": "Infinity" }""",
        """{ "endReason": "stopped", "audioSecondsSent": "-Infinity", "engine": ["cloud"] }""",
        """ "stopped" """,
        """[1, 2]""",
        """{ "endReason": "stopped", "coveredSeconds": 1e400, "streamCount": 99999999999 }""",
    };

    // Review: a malformed health block must never fail the transcript save — it is logged as
    // malformed and the save goes through.
    [Theory]
    [MemberData(nameof(MalformedHealth))]
    public async Task Given_a_malformed_health_block_When_saved_Then_the_save_succeeds_and_health_is_logged_as_malformed(string healthJson)
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);
        var text = JsonSerializer.Serialize(TranscriptMarker);

        var draft = await h.Client.PutAsync($"/notes/{noteId}/transcription/draft",
            new StringContent($$"""{ "transcriptText": {{text}}, "durationSeconds": 600, "health": {{healthJson}} }""", System.Text.Encoding.UTF8, "application/json"));
        var complete = await h.Client.PostAsync($"/notes/{noteId}/transcription",
            new StringContent($$"""{ "transcriptText": {{text}}, "durationSeconds": 600, "health": {{healthJson}} }""", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, draft.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, complete.StatusCode);
        Assert.Equal(2, h.HealthLines.Count);
        Assert.All(h.HealthLines, l => Assert.Contains("malformed", l.Message));
        Assert.Empty(h.Metrics.TranscriptCoverages);
    }

    [Fact]
    public async Task Given_a_well_formed_health_block_Then_it_is_not_logged_as_malformed()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 5302, ErroredStream());

        Assert.DoesNotContain("malformed", Assert.Single(h.HealthLines).Message);
    }

    // Review nit: line/paragraph separators and bidi controls can disguise a log line too.
    [Fact]
    public async Task Given_an_error_message_with_separators_and_bidi_controls_Then_they_are_stripped()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 600, new
        {
            endReason = "error",
            errorName = "Bad\u202EName",
            errorMessage = "line one\u2028line two\u2029para\u200Fmark\u2066iso\u2069end\r\nnext",
        });

        var line = Assert.Single(h.HealthLines);
        Assert.Contains("error=BadName: line oneline twoparamarkisoendnext", line.Message);
    }

    // BUG-85 slice 1 — twice the live transcript stopped part-way through a meeting while the timer
    // kept running. Counting buffers pushed could not tell a dead microphone from a silent room, so
    // the save now also carries whether the captured audio source died, whether any sound at all is
    // reaching it, and for how long it has been silent.

    [Fact]
    public async Task Given_a_dead_audio_source_When_a_stalled_draft_is_saved_Then_the_line_says_the_source_ended()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 900, new
        {
            engine = "cloud",
            endReason = "stalled",
            coveredSeconds = 700,
            secondsSinceLastText = 200,
            audioSecondsSent = 900,
            secondsSinceLastAudio = 0,
            streamCount = 1,
            sourceEnded = true,
            sourceMuted = false,
            audioSilent = true,
            secondsSilent = 210.4,
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("sourceEnded=True muted=False silent=True silentFor=210s", line.Message);
        Assert.DoesNotContain("malformed", line.Message);
    }

    // Audio arriving at a normal rate and no sound in it is the case the old record could not
    // express at all: it looked identical to a room full of speech.
    [Fact]
    public async Task Given_silence_while_audio_keeps_flowing_When_a_draft_is_saved_Then_it_warns_even_in_progress()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await DraftAsync(h.Client, noteId, 900, new
        {
            engine = "cloud",
            endReason = "inProgress",
            streamCount = 1,
            audioSecondsSent = 900,
            secondsSinceLastAudio = 0,
            sourceEnded = false,
            sourceMuted = false,
            audioSilent = true,
            secondsSilent = 620,
        });

        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Warning, line.Level);
        Assert.Contains("silent=True silentFor=620s", line.Message);
    }

    [Fact]
    public async Task Given_a_healthy_recording_When_completed_Then_the_new_fields_log_without_a_warning()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await CompleteAsync(h.Client, noteId, 600, new
        {
            engine = "cloud",
            endReason = "stopped",
            coveredSeconds = 590,
            streamCount = 1,
            sourceEnded = false,
            sourceMuted = false,
            audioSilent = false,
            secondsSilent = 2,
        });

        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("sourceEnded=False muted=False silent=False silentFor=2s", line.Message);
    }

    // An installed build from before this change sends none of these. It must still save, and the
    // absent facts must read as absent rather than as "everything is fine".
    [Fact]
    public async Task Given_a_build_without_the_source_and_silence_fields_When_completed_Then_they_read_as_absent()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await CompleteAsync(h.Client, noteId, 600,
            new { engine = "cloud", endReason = "stopped", coveredSeconds = 590, streamCount = 1 });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("sourceEnded=- muted=- silent=- silentFor=-s", line.Message);
        Assert.DoesNotContain("malformed", line.Message);
    }

    [Fact]
    public async Task Given_a_source_flag_of_the_wrong_type_When_saved_Then_it_is_named_malformed_and_the_save_succeeds()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);
        var text = JsonSerializer.Serialize(TranscriptMarker);

        var resp = await h.Client.PostAsync($"/notes/{noteId}/transcription",
            new StringContent(
                $$"""{ "transcriptText": {{text}}, "durationSeconds": 600, "health": { "endReason": "stopped", "sourceEnded": "yes", "audioSilent": 1, "secondsSilent": "long" } }""",
                System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Contains("malformed=sourceEnded,audioSilent,secondsSilent", line.Message);
        Assert.Contains("sourceEnded=- muted=- silent=-", line.Message);
    }

    // BUG-85 — when a transcript stops, the record has to say whether people were still speaking.
    // The silence flag catches only a dead source; a quiet room and a room full of speech looked the
    // same. The save now carries how loud the audio was since the last words, and for how long it
    // was at speech level.

    [Fact]
    public async Task Given_a_stall_with_speech_arriving_When_a_draft_is_saved_Then_the_line_says_how_loud_and_how_much_speech()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await DraftAsync(h.Client, noteId, 900, new
        {
            engine = "cloud",
            endReason = "stalled",
            secondsSinceLastText = 200,
            streamCount = 1,
            audioSilent = false,
            secondsSilent = 1,
            loudestDbfs = -14.2,
            speechSeconds = 61.37,
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Contains("loudest=-14.2dBFS speech=61.4s", line.Message);
        Assert.DoesNotContain("malformed", line.Message);
    }

    [Fact]
    public async Task Given_a_build_without_the_loudness_fields_When_completed_Then_they_read_as_absent_not_zero()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        var resp = await CompleteAsync(h.Client, noteId, 600, new
        {
            engine = "cloud",
            endReason = "stopped",
            coveredSeconds = 590,
            streamCount = 1,
            sourceEnded = false,
            sourceMuted = false,
            audioSilent = false,
            secondsSilent = 2,
        });

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Equal(LogLevel.Information, line.Level);
        Assert.Contains("loudest=- speech=-", line.Message);
        Assert.DoesNotContain("malformed", line.Message);
    }

    [Theory]
    [InlineData(12.0, 5000.0, "loudest=0dBFS speech=5000s")]
    [InlineData(-900.0, -3.0, "loudest=-100dBFS speech=0s")]
    [InlineData(-45.04, 1e9, "loudest=-45dBFS speech=86400s")]
    public async Task Given_out_of_range_loudness_When_saved_Then_it_is_clamped(double loudest, double speech, string expected)
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);

        await DraftAsync(h.Client, noteId, 900, new { endReason = "stalled", loudestDbfs = loudest, speechSeconds = speech });

        Assert.Contains(expected, Assert.Single(h.HealthLines).Message);
    }

    [Fact]
    public async Task Given_loudness_of_the_wrong_type_When_saved_Then_it_is_named_malformed_and_the_save_succeeds()
    {
        var h = Build();
        var noteId = await CreateNoteAsync(h.Client);
        var text = JsonSerializer.Serialize(TranscriptMarker);

        var resp = await h.Client.PostAsync($"/notes/{noteId}/transcription",
            new StringContent(
                $$"""{ "transcriptText": {{text}}, "durationSeconds": 600, "health": { "endReason": "stopped", "loudestDbfs": "loud", "speechSeconds": true } }""",
                System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.NoContent, resp.StatusCode);
        var line = Assert.Single(h.HealthLines);
        Assert.Contains("malformed=loudestDbfs,speechSeconds", line.Message);
        Assert.Contains("loudest=- speech=-", line.Message);
    }

    private sealed class ThrowingTranscriptMetrics : IDomainMetrics
    {
        public void CommandHandled(string commandType, string aggregate) { }
        public void CommandFailed(string commandType, string exceptionType) { }
        public void EventsAppended(string aggregate, int count) { }
        public void ConcurrencyConflict(string aggregate) { }
        public void SearchPerformed(int resultCount, int notesScanned, double latencyMs) { }
        public void ProjectionRebuildDuration(double milliseconds) { }
        public void ProjectionRebuildFault() { }
        public void AnalysisCompleted(double milliseconds) { }
        public void AnalysisFailed() { }
        public void SignInCompleted(bool consentIssued) { }
        public void SessionRefresh(string outcome) { }
        public void RefreshTokenStoreWriteFault() { }
        public void RefreshTokenRevoked() { }
        public void TranscriptCoverage(double ratio) => throw new InvalidOperationException("metrics down");
        public void TranscriptStalled() => throw new InvalidOperationException("metrics down");
    }
}
