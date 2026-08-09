namespace Api.Exceptions;

// Thrown when the 43-H1 agenda migration is requested while one is already running.
// Mapped to 409 in LoggingConfig — the migration is a single-flight maintenance op.
public sealed class MigrationInProgressException : Exception
{
    public MigrationInProgressException() : base("An agenda migration is already in progress.") { }
}
