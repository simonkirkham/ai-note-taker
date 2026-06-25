using Amazon.DynamoDBv2.Model;
using Api.CommandHandlers;

namespace Api.Integration;

public sealed class BoundedWritesTests
{
    [Fact]
    public async Task RunAsync_caps_in_flight_concurrency()
    {
        var sync = new object();
        var inFlight = 0;
        var maxObserved = 0;
        var writes = Enumerable.Range(0, 50)
            .Select(_ => (Func<CancellationToken, Task>)(async ct =>
            {
                lock (sync) { inFlight++; maxObserved = Math.Max(maxObserved, inFlight); }
                await Task.Delay(10, ct);
                lock (sync) { inFlight--; }
            }))
            .ToList();

        await BoundedWrites.RunAsync(writes, maxConcurrency: 5, baseDelay: TimeSpan.FromMilliseconds(1));

        Assert.True(maxObserved <= 5, $"max in-flight was {maxObserved}, expected <= 5");
        Assert.Equal(0, inFlight);
    }

    [Fact]
    public async Task WithRetryAsync_retries_transient_fault_then_succeeds()
    {
        var attempts = 0;
        await BoundedWrites.WithRetryAsync(_ =>
        {
            attempts++;
            if (attempts < 3) throw new ProvisionedThroughputExceededException("cold-table throttle");
            return Task.CompletedTask;
        }, maxAttempts: 5, baseDelay: TimeSpan.FromMilliseconds(1));

        Assert.Equal(3, attempts);
    }

    [Fact]
    public async Task WithRetryAsync_retries_a_per_operation_timeout_cancellation()
    {
        // The 5s client timeout surfaces as an OperationCanceledException carrying the SDK's
        // own (foreign) token, not the caller's — so it must be retried, not surfaced.
        var attempts = 0;
        await BoundedWrites.WithRetryAsync(_ =>
        {
            attempts++;
            if (attempts < 2) throw new OperationCanceledException(new CancellationToken(canceled: true));
            return Task.CompletedTask;
        }, maxAttempts: 5, baseDelay: TimeSpan.FromMilliseconds(1));

        Assert.Equal(2, attempts);
    }

    [Fact]
    public async Task WithRetryAsync_does_not_retry_when_the_caller_cancels()
    {
        using var cts = new CancellationTokenSource();
        var attempts = 0;
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            BoundedWrites.WithRetryAsync(token =>
            {
                attempts++;
                cts.Cancel();
                token.ThrowIfCancellationRequested();
                return Task.CompletedTask;
            }, maxAttempts: 5, baseDelay: TimeSpan.FromMilliseconds(1), ct: cts.Token));

        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task WithRetryAsync_does_not_retry_a_non_transient_fault()
    {
        var attempts = 0;
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            BoundedWrites.WithRetryAsync(_ =>
            {
                attempts++;
                throw new InvalidOperationException("permanent");
            }, maxAttempts: 5, baseDelay: TimeSpan.FromMilliseconds(1)));

        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task WithRetryAsync_surfaces_transient_fault_after_max_attempts()
    {
        var attempts = 0;
        await Assert.ThrowsAsync<ProvisionedThroughputExceededException>(() =>
            BoundedWrites.WithRetryAsync(_ =>
            {
                attempts++;
                throw new ProvisionedThroughputExceededException("always throttled");
            }, maxAttempts: 3, baseDelay: TimeSpan.FromMilliseconds(1)));

        Assert.Equal(3, attempts);
    }
}
