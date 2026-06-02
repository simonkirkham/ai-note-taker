using Api.Observability;

namespace Api.Integration;

internal sealed class RecordingDomainMetrics : IDomainMetrics
{
    public List<(string CommandType, string Aggregate)> Handled { get; } = [];
    public List<(string CommandType, string ExceptionType)> Failed { get; } = [];
    public List<(string Aggregate, int Count)> Appended { get; } = [];
    public List<string> Conflicts { get; } = [];

    public void CommandHandled(string commandType, string aggregate) => Handled.Add((commandType, aggregate));

    public void CommandFailed(string commandType, string exceptionType) => Failed.Add((commandType, exceptionType));

    public void EventsAppended(string aggregate, int count) => Appended.Add((aggregate, count));

    public void ConcurrencyConflict(string aggregate) => Conflicts.Add(aggregate);
}
