namespace Api.Exceptions;

// Thrown when a projection rebuild is requested while one is already running.
// Mapped to 409 in LoggingConfig — a rebuild is a single-flight maintenance op.
public sealed class RebuildInProgressException : Exception
{
    public RebuildInProgressException() : base("A projection rebuild is already in progress.") { }
}
