namespace Api.Observability;

public interface IDomainMetrics
{
    void CommandHandled(string commandType, string aggregate);

    void CommandFailed(string commandType, string exceptionType);

    void EventsAppended(string aggregate, int count);

    void ConcurrencyConflict(string aggregate);
}
