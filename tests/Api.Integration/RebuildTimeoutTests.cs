using System.Net;
using EventStore;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// Wraps an inner event store and throws on the first N ReadAllStreamsAsync calls — the
// unprotected read the rebuild starts with. Mirrors the prod failure: a transient AWSSDK.Core
// TimeoutException ("The operation was canceled.") on a DynamoDB scan. The thrown exception is
// pluggable so we can also exercise the OperationCanceledException-with-a-foreign-token path
// (an SDK per-op timeout), which must be treated transient — not as a client abort.
internal sealed class TimeoutInjectingEventStore(IEventStore inner, int failures, Func<Exception> fault) : IEventStore
{
    private int _remaining = failures;

    public Task AppendAsync(string streamId, long expectedVersion, IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
        => inner.AppendAsync(streamId, expectedVersion, events, ct);

    public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default)
        => inner.ReadAsync(streamId, ct);

    public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default)
    {
        if (_remaining > 0)
        {
            _remaining--;
            throw fault();
        }
        return inner.ReadAllStreamsAsync(ct);
    }
}

// BUG-23: a transient DynamoDB TimeoutException on a read inside the rebuild must be retried,
// not surfaced as an unhandled 500; a persistent timeout must map to 503, never 500.
// Shares the ProjectionRebuild collection so it serialises against the static single-flight lock.
[Collection("ProjectionRebuild")]
public sealed class RebuildTimeoutTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    // A foreign token (NOT the request's) cancelled — mimics an AWS SDK per-op timeout that
    // cancels with its own token. Must be treated as transient, not as a client abort.
    private static Exception SdkTimeout() => new TimeoutException("The operation was canceled.");
    private static Exception SdkCancel()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        return new OperationCanceledException(cts.Token);
    }

    [Fact]
    public async Task Rebuild_recovers_from_a_transient_read_timeout()
    {
        var resp = await PostRebuildWithReadFailures(1, SdkTimeout);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Rebuild_that_persistently_times_out_returns_503_not_500()
    {
        var resp = await PostRebuildWithReadFailures(int.MaxValue, SdkTimeout);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }

    [Fact]
    public async Task Rebuild_recovers_from_a_transient_read_cancellation()
    {
        var resp = await PostRebuildWithReadFailures(1, SdkCancel);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
    }

    [Fact]
    public async Task Rebuild_that_persistently_cancels_returns_503_not_500()
    {
        var resp = await PostRebuildWithReadFailures(int.MaxValue, SdkCancel);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, resp.StatusCode);
    }

    private async Task<HttpResponseMessage> PostRebuildWithReadFailures(int failures, Func<Exception> fault)
    {
        var custom = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp =>
                ApiFactory.BuildSyncProjectingStore(
                    sp, new TimeoutInjectingEventStore(new InMemoryEventStore(), failures, fault)));
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        return await client.PostAsync("/admin/projections/rebuild", null);
    }
}
