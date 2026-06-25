using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

internal sealed record CapturedLog(string Category, LogLevel Level, string Message);

internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    public ConcurrentQueue<CapturedLog> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, Entries);

    public void Dispose() { }

    private sealed class CapturingLogger(string category, ConcurrentQueue<CapturedLog> sink) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
            => sink.Enqueue(new CapturedLog(category, logLevel, formatter(state, exception)));
    }
}
