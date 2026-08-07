using Amazon;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Amazon.Runtime;
using Api.Services;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// BUG-58: the Bedrock Converse call had no client-side deadline, so a stalled inference ran until
// the Command Lambda's 29s limit killed the process — no exception, no log, no metric, no alarm.
// The deadline turns that silent kill into a TimeoutException the caller can see and report.
public sealed class BedrockAnalysisDeadlineTests
{
    private readonly CapturingLoggerProvider _logs = new();

    private BedrockAnalysisService Service(IAmazonBedrockRuntime bedrock, TimeSpan timeout)
    {
        using var factory = LoggerFactory.Create(b => b.AddProvider(_logs));
        return new BedrockAnalysisService(bedrock, factory.CreateLogger<BedrockAnalysisService>(),
            PromptCatalog.Current, "amazon.nova-lite-v1:0", timeout);
    }

    [Fact]
    public async Task Converse_that_outlives_the_deadline_throws_TimeoutException_and_logs_an_error()
    {
        var service = Service(new DelayingBedrockRuntime(TimeSpan.FromSeconds(30)), TimeSpan.FromMilliseconds(100));

        var ex = await Assert.ThrowsAsync<TimeoutException>(() =>
            service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice")));

        // Assert the stable phrase, never the formatted number — interpolating a double uses the
        // CURRENT culture, so "0.1" is "0,1" under de-DE and the assertion would fail off en-*.
        Assert.Contains("did not complete within", ex.Message);
        Assert.Contains(_logs.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("exceeded its"));
    }

    [Fact]
    public async Task Converse_inside_the_deadline_returns_normally()
    {
        var service = Service(new DelayingBedrockRuntime(TimeSpan.Zero), TimeSpan.FromSeconds(10));

        var result = await service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice"));

        Assert.Equal("amazon.nova-lite-v1:0", result.ModelId);
    }

    // A cancelled CALLER (client disconnect, Lambda shutdown) is not an analysis failure — it must
    // stay an OperationCanceledException so it is never mis-reported as a Bedrock outage.
    [Fact]
    public async Task Caller_cancellation_propagates_as_OperationCanceledException()
    {
        var service = Service(new DelayingBedrockRuntime(TimeSpan.FromSeconds(30)), TimeSpan.FromSeconds(30));
        using var caller = new CancellationTokenSource();
        caller.CancelAfter(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice"), caller.Token));
    }

    // The both-cancelled case: the caller's token AND the deadline are both tripped when the call
    // unwinds. It must NOT become a TimeoutException (there is no one left to serve a 503 to, and it
    // is not a Bedrock outage) — but it must never be traceless either, which is the whole point of
    // BUG-58. Pre-cancelling the caller makes the linked source cancelled on creation, so both are
    // set with no race. Without the caller arm ordered first, this returns a TimeoutException.
    [Fact]
    public async Task Caller_cancellation_that_also_trips_the_deadline_stays_a_cancellation_and_still_logs()
    {
        var service = Service(new DelayingBedrockRuntime(TimeSpan.FromSeconds(30)), TimeSpan.Zero);
        using var caller = new CancellationTokenSource();
        await caller.CancelAsync();

        var ex = await Record.ExceptionAsync(() =>
            service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice"), caller.Token));

        Assert.IsNotType<TimeoutException>(ex);
        Assert.IsAssignableFrom<OperationCanceledException>(ex);
        Assert.Contains(_logs.Entries, e => e.Level == LogLevel.Warning && e.Message.Contains("abandoned"));
    }

    // Hawk (PR #424): every other test here throws a BARE OperationCanceledException, because the
    // double bypasses the SDK pipeline entirely. If the real SDK instead WRAPS the cancellation —
    // AmazonClientException is the documented shape for a client-side abort — a filter that matched
    // only OperationCanceledException would let it escape: no TimeoutException, no 503, no
    // AnalysisFailures increment, i.e. BUG-58 unchanged. This pins the behaviour against the wrapped
    // shape so the classification cannot regress to being SDK-shape-dependent.
    [Fact]
    public async Task A_wrapped_cancellation_from_the_sdk_still_becomes_a_timeout()
    {
        var service = Service(new WrappingBedrockRuntime(TimeSpan.FromSeconds(30)), TimeSpan.FromMilliseconds(50));

        var ex = await Record.ExceptionAsync(() =>
            service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice"), CancellationToken.None));

        var timeout = Assert.IsType<TimeoutException>(ex);
        Assert.IsType<AmazonClientException>(timeout.InnerException);
        Assert.Contains(_logs.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("deadline"));
    }

    // Same delay behaviour as DelayingBedrockRuntime, but wraps the cancellation the way the SDK's
    // handler pipeline can — the shape the plain double structurally cannot produce.
    private sealed class WrappingBedrockRuntime(TimeSpan delay) : AmazonBedrockRuntimeClient(
        new BasicAWSCredentials("test", "test"),
        new AmazonBedrockRuntimeConfig { RegionEndpoint = RegionEndpoint.EUWest2 })
    {
        public override async Task<ConverseResponse> ConverseAsync(
            ConverseRequest request, CancellationToken cancellationToken = default)
        {
            try
            {
                await Task.Delay(delay, cancellationToken);
            }
            catch (OperationCanceledException ex)
            {
                throw new AmazonClientException("Request cancelled by the client.", ex);
            }
            throw new InvalidOperationException("unreachable in this test");
        }
    }

    // The SDK client is subclassed rather than the (very wide) interface hand-implemented; the
    // generated ConverseAsync is virtual and no network call is made.
    private sealed class DelayingBedrockRuntime(TimeSpan delay) : AmazonBedrockRuntimeClient(
        new BasicAWSCredentials("test", "test"),
        new AmazonBedrockRuntimeConfig { RegionEndpoint = RegionEndpoint.EUWest2 })
    {
        public override async Task<ConverseResponse> ConverseAsync(
            ConverseRequest request, CancellationToken cancellationToken = default)
        {
            await Task.Delay(delay, cancellationToken);
            return new ConverseResponse
            {
                Output = new ConverseOutput
                {
                    Message = new Message
                    {
                        Role = ConversationRole.Assistant,
                        Content = [new ContentBlock { Text = "{}" }]
                    }
                }
            };
        }
    }
}
