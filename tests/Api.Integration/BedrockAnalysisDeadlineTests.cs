using Amazon;
using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Amazon.Runtime;
using Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// BUG-58: the Bedrock Converse call had no client-side deadline, so a stalled inference ran until
// the Command Lambda's 29s limit killed the process — no exception, no log, no metric, no alarm.
// The deadline turns that silent kill into a TimeoutException the caller can see and report.
public sealed class BedrockAnalysisDeadlineTests
{
    private static BedrockAnalysisService Service(IAmazonBedrockRuntime bedrock, TimeSpan timeout) =>
        new(bedrock, NullLogger<BedrockAnalysisService>.Instance, PromptCatalog.Current,
            "amazon.nova-lite-v1:0", timeout);

    [Fact]
    public async Task Converse_that_outlives_the_deadline_throws_TimeoutException()
    {
        var service = Service(new DelayingBedrockRuntime(TimeSpan.FromSeconds(30)), TimeSpan.FromMilliseconds(100));

        var ex = await Assert.ThrowsAsync<TimeoutException>(() =>
            service.AnalyseAsync(new NoteAnalysisRequest("Notes", "A transcript.", "Alice")));

        Assert.Contains("0.1", ex.Message);
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
