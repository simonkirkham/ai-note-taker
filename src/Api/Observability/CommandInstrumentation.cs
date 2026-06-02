using Api.Exceptions;

namespace Api.Observability;

public static class CommandInstrumentation
{
    public static Task RunAsync(IDomainMetrics metrics, ILogger logger, string commandType, string aggregate, Func<Task> body) =>
        RunAsync(metrics, logger, commandType, aggregate, async () =>
        {
            await body().ConfigureAwait(false);
            return true;
        });

    public static async Task<T> RunAsync<T>(IDomainMetrics metrics, ILogger logger, string commandType, string aggregate, Func<Task<T>> body)
    {
        logger.LogInformation("Command received {CommandType} {Aggregate}", commandType, aggregate);
        try
        {
            var result = await body().ConfigureAwait(false);
            metrics.CommandHandled(commandType, aggregate);
            return result;
        }
        catch (Exception ex) when (IsDomainViolation(ex))
        {
            metrics.CommandFailed(commandType, ex.GetType().Name);
            logger.LogWarning("Command failed {CommandType} {Aggregate} {ExceptionType} {Message}",
                commandType, aggregate, ex.GetType().Name, ex.Message);
            throw;
        }
    }

    // Domain rule violations are expected business outcomes: logged as Warning, counted
    // as CommandFailed. ConcurrencyException (counted by the event-store decorator) and
    // infrastructure errors are deliberately excluded — the global handler maps a
    // ConcurrencyException to 409 and any other infrastructure error to a 500 logged at
    // Error, rather than masking either as a domain failure here.
    // CycleDetectedException derives from InvalidOperationException, so it is covered here too.
    private static bool IsDomainViolation(Exception ex) =>
        ex is InvalidOperationException
            or NoteNotFoundException
            or ActionItemNotFoundException
            or FolderNotFoundException;
}
