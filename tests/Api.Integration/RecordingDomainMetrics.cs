using Api.Observability;

namespace Api.Integration;

internal sealed class RecordingDomainMetrics : IDomainMetrics
{
    public List<(string CommandType, string Aggregate)> Handled { get; } = [];
    public List<(string CommandType, string ExceptionType)> Failed { get; } = [];
    public List<(string Aggregate, int Count)> Appended { get; } = [];
    public List<string> Conflicts { get; } = [];
    public List<(int ResultCount, int NotesScanned, double LatencyMs)> Searches { get; } = [];
    public List<double> RebuildDurations { get; } = [];
    public int RebuildFaults { get; private set; }
    public List<double> AnalysisDurations { get; } = [];
    public int AnalysisFailures { get; private set; }
    public List<bool> SignIns { get; } = [];
    public List<string> SessionRefreshes { get; } = [];

    public void CommandHandled(string commandType, string aggregate) => Handled.Add((commandType, aggregate));

    public void CommandFailed(string commandType, string exceptionType) => Failed.Add((commandType, exceptionType));

    public void EventsAppended(string aggregate, int count) => Appended.Add((aggregate, count));

    public void ConcurrencyConflict(string aggregate) => Conflicts.Add(aggregate);

    public void SearchPerformed(int resultCount, int notesScanned, double latencyMs) =>
        Searches.Add((resultCount, notesScanned, latencyMs));

    public void ProjectionRebuildDuration(double milliseconds) => RebuildDurations.Add(milliseconds);

    public void ProjectionRebuildFault() => RebuildFaults++;

    public void AnalysisCompleted(double milliseconds) => AnalysisDurations.Add(milliseconds);

    public void AnalysisFailed() => AnalysisFailures++;

    public void SignInCompleted(bool consentIssued) => SignIns.Add(consentIssued);

    public void SessionRefresh(string outcome) => SessionRefreshes.Add(outcome);
}
