using AWS.Lambda.Powertools.Metrics;

namespace Api.Observability;

public sealed class PowertoolsDomainMetrics : IDomainMetrics
{
    private const string MetricNamespace = "NoteTaker/Domain";
    private const string ServiceName = "note-taker";

    public void CommandHandled(string commandType, string aggregate) =>
        Push("CommandHandled", 1, new Dictionary<string, string> { ["CommandType"] = commandType, ["Aggregate"] = aggregate });

    public void CommandFailed(string commandType, string exceptionType) =>
        Push("CommandFailed", 1, new Dictionary<string, string> { ["CommandType"] = commandType, ["ExceptionType"] = exceptionType });

    public void EventsAppended(string aggregate, int count) =>
        Push("EventsAppended", count, new Dictionary<string, string> { ["Aggregate"] = aggregate });

    public void ConcurrencyConflict(string aggregate) =>
        Push("ConcurrencyConflict", 1, new Dictionary<string, string> { ["Aggregate"] = aggregate });

    // Privacy: SearchPerformed carries only counts and latency — never the query text
    // or any note content (meeting notes are sensitive). resultCount drives the
    // zero-result-rate watch; notesScanned + latency quantify the linear-scan cost curve.
    public void SearchPerformed(int resultCount, int notesScanned, double latencyMs)
    {
        var dimensions = new Dictionary<string, string> { ["Aggregate"] = "Note" };
        Push("SearchPerformed", 1, dimensions);
        Push("SearchResultCount", resultCount, dimensions);
        Push("SearchNotesScanned", notesScanned, dimensions);
        Metrics.PushSingleMetric("SearchLatencyMs", latencyMs, MetricUnit.Milliseconds,
            nameSpace: MetricNamespace, service: ServiceName, dimensions: dimensions);
    }

    // Rebuild metrics carry ONLY the Service dimension (no per-run dimension), so each is a
    // single concrete metric a CloudWatch alarm can target — alarms reject SEARCH across a
    // varying dimension. The faulting exception type stays in the structured log, not a dimension.
    public void ProjectionRebuildDuration(double milliseconds) =>
        Metrics.PushSingleMetric("ProjectionRebuildDuration", milliseconds, MetricUnit.Milliseconds,
            nameSpace: MetricNamespace, service: ServiceName);

    public void ProjectionRebuildFault() =>
        Metrics.PushSingleMetric("ProjectionRebuildFault", 1, MetricUnit.Count,
            nameSpace: MetricNamespace, service: ServiceName);

    // Dimensionless (Service only), like the rebuild metrics — a single concrete metric
    // an alarm can target. The failing note's id lives in the structured log, not a dimension.
    public void AnalysisCompleted(double milliseconds) =>
        Metrics.PushSingleMetric("AnalysisDurationMs", milliseconds, MetricUnit.Milliseconds,
            nameSpace: MetricNamespace, service: ServiceName);

    public void AnalysisFailed() =>
        Metrics.PushSingleMetric("AnalysisFailed", 1, MetricUnit.Count,
            nameSpace: MetricNamespace, service: ServiceName);

    // PushSingleMetric emits a self-contained EMF blob with its own dimensions, so no
    // global namespace/flush setup (or the [Metrics] handler decorator) is needed —
    // which suits an ASP.NET-Core-on-Lambda host that has no Lambda handler method.
    private static void Push(string name, double value, Dictionary<string, string> dimensions) =>
        Metrics.PushSingleMetric(name, value, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName, dimensions: dimensions);
}
