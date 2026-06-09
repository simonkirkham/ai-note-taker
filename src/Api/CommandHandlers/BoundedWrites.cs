using System.Net;
using Amazon.DynamoDBv2.Model;
using Amazon.Runtime;

namespace Api.CommandHandlers;

// Runs a batch of projection writes with bounded concurrency and per-write retry,
// so a cold on-demand DynamoDB table is not hit with a ~290-write spike (which
// throttles, cancels writes at the 5s client timeout, and faults the whole batch).
// A transient fault on one write is retried with backoff+jitter rather than failing
// the rebuild; a genuinely permanent fault still surfaces. See Phase 24-A.
public static class BoundedWrites
{
    public const int DefaultMaxConcurrency = 8;
    public const int DefaultMaxAttempts = 5;
    static readonly TimeSpan DefaultBaseDelay = TimeSpan.FromMilliseconds(200);

    public static async Task RunAsync(
        IReadOnlyList<Func<CancellationToken, Task>> writes,
        int maxConcurrency = DefaultMaxConcurrency,
        int maxAttempts = DefaultMaxAttempts,
        TimeSpan? baseDelay = null,
        CancellationToken ct = default)
    {
        using var gate = new SemaphoreSlim(maxConcurrency, maxConcurrency);
        var running = writes.Select(async write =>
        {
            await gate.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                await WithRetryAsync(write, maxAttempts, baseDelay, ct).ConfigureAwait(false);
            }
            finally
            {
                gate.Release();
            }
        });
        await Task.WhenAll(running).ConfigureAwait(false);
    }

    public static async Task WithRetryAsync(
        Func<CancellationToken, Task> write,
        int maxAttempts = DefaultMaxAttempts,
        TimeSpan? baseDelay = null,
        CancellationToken ct = default)
    {
        var delay = baseDelay ?? DefaultBaseDelay;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                await write(ct).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (attempt < maxAttempts && IsTransient(ex, ct))
            {
                var backoff = delay.TotalMilliseconds * Math.Pow(2, attempt - 1);
                var jitter = Random.Shared.Next(0, 50);
                await Task.Delay(TimeSpan.FromMilliseconds(backoff + jitter), ct).ConfigureAwait(false);
            }
        }
    }

    // A transient fault is one a retry can clear: an on-demand throttle, a per-op client
    // timeout (surfaces as OperationCanceledException while the caller's ct is NOT cancelled),
    // or a 5xx/429 from the service. A requested outer cancellation is never transient.
    static bool IsTransient(Exception ex, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return false;
        return ex switch
        {
            ProvisionedThroughputExceededException => true,
            RequestLimitExceededException => true,
            InternalServerErrorException => true,
            TimeoutException => true,
            OperationCanceledException => true,
            AmazonServiceException ase => ase.StatusCode is HttpStatusCode.ServiceUnavailable
                or HttpStatusCode.InternalServerError
                or (HttpStatusCode)429,
            _ => false
        };
    }
}
