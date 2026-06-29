using System.Net;
using Amazon.DynamoDBv2.Model;
using Amazon.Runtime;

namespace Api.CommandHandlers;

// Bounded-concurrency + per-write retry for the projection rebuild: a cold on-demand table
// hit with a ~290-write spike throttles, cancels writes at the 5s client timeout, and faults
// the whole batch (500 + partial rebuild). See Phase 24-A.
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

    public static Task WithRetryAsync(
        Func<CancellationToken, Task> write,
        int maxAttempts = DefaultMaxAttempts,
        TimeSpan? baseDelay = null,
        CancellationToken ct = default)
        => WithRetryAsync<object?>(
            async c => { await write(c).ConfigureAwait(false); return null; },
            maxAttempts, baseDelay, ct);

    // BUG-23: the rebuild's READS (ReadAllStreamsAsync, the per-projection QueryAll/GetAll scans)
    // were unretried — a single transient TimeoutException on a read aborted the whole rebuild
    // with a 500. This result-returning overload lets those reads share the same bounded
    // retry-with-backoff the writes already used. The void overload above delegates here.
    public static async Task<T> WithRetryAsync<T>(
        Func<CancellationToken, Task<T>> op,
        int maxAttempts = DefaultMaxAttempts,
        TimeSpan? baseDelay = null,
        CancellationToken ct = default)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxAttempts);
        var delay = baseDelay ?? DefaultBaseDelay;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await op(ct).ConfigureAwait(false);
            }
            catch (Exception ex) when (attempt < maxAttempts && IsTransient(ex, ct))
            {
                var backoff = delay.TotalMilliseconds * Math.Pow(2, attempt - 1);
                var jitter = Random.Shared.NextDouble() * backoff * 0.2;
                await Task.Delay(TimeSpan.FromMilliseconds(backoff + jitter), ct).ConfigureAwait(false);
            }
        }
    }

    // Transient = on-demand throttle, a per-op client timeout (the SDK cancels with its OWN
    // token, so the caller's ct is not cancelled), or a 5xx/429. A cancellation carrying the
    // caller's token is a genuine abort and is never retried.
    static bool IsTransient(Exception ex, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return false;
        if (ex is OperationCanceledException oce && oce.CancellationToken == ct) return false;
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
