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

    // PushSingleMetric emits a self-contained EMF blob with its own dimensions, so no
    // global namespace/flush setup (or the [Metrics] handler decorator) is needed —
    // which suits an ASP.NET-Core-on-Lambda host that has no Lambda handler method.
    private static void Push(string name, double value, Dictionary<string, string> dimensions) =>
        Metrics.PushSingleMetric(name, value, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName, dimensions: dimensions);
}
