namespace Api.Observability;

public interface IDomainMetrics
{
    void CommandHandled(string commandType, string aggregate);

    void CommandFailed(string commandType, string exceptionType);

    void EventsAppended(string aggregate, int count);

    void ConcurrencyConflict(string aggregate);

    void SearchPerformed(int resultCount, int notesScanned, double latencyMs);

    void ProjectionRebuildDuration(double milliseconds);

    void ProjectionRebuildFault();

    // Analysis (Bedrock) timing + failures. AnalysisCompleted carries the inference
    // latency (drives the p50/p99 widget); AnalysisFailed is the alarmable count — the
    // failing note's id stays in the structured log, never a metric dimension.
    void AnalysisCompleted(double milliseconds);

    void AnalysisFailed();
}
