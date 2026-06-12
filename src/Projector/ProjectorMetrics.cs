using AWS.Lambda.Powertools.Metrics;

namespace Projector;

public interface IProjectorMetrics
{
    void Applied(int count);
    void Lag(double milliseconds);
    void Failure();
    void DuplicateSkipped();
}

// EMF metrics for the async projector. Each carries ONLY the Service dimension (no varying
// per-stream dimension), so each is a single concrete metric a CloudWatch alarm can target
// (alarms reject SEARCH across a varying dimension) — same rule as the rebuild metrics.
public sealed class ProjectorMetrics : IProjectorMetrics
{
    private const string MetricNamespace = "NoteTaker/Domain";
    private const string ServiceName = "note-taker-projector";

    public void Applied(int count) =>
        Metrics.PushSingleMetric("ProjectorApplied", count, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName);

    // now − OccurredAt at apply time: how far the read models lag the log.
    public void Lag(double milliseconds) =>
        Metrics.PushSingleMetric("ProjectorLag", milliseconds, MetricUnit.Milliseconds, nameSpace: MetricNamespace, service: ServiceName);

    // Async failures are otherwise invisible (no synchronous 500) — this drives the alarm.
    public void Failure() =>
        Metrics.PushSingleMetric("ProjectorFailure", 1, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName);

    public void DuplicateSkipped() =>
        Metrics.PushSingleMetric("ProjectorDuplicateSkipped", 1, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName);
}
