using AWS.Lambda.Powertools.Metrics;

namespace TranscribeCompletion;

public interface ITranscribeCompletionMetrics
{
    void BatchCompleted(double durationMs);
    void BatchFailed();
}

// EMF metrics for the async batch-diarization completion handler. Each carries ONLY the Service
// dimension (no varying per-job dimension), so each is a single concrete metric a CloudWatch alarm
// can target — same rule as the projector metrics. A FAILED job (or a fetch/parse error that leaves
// the streamed transcript intact) is otherwise invisible (no synchronous 500); BatchFailed drives
// the alarm.
public sealed class TranscribeCompletionMetrics : ITranscribeCompletionMetrics
{
    private const string MetricNamespace = "NoteTaker/Domain";
    private const string ServiceName = "note-taker-transcribe";

    public void BatchCompleted(double durationMs)
    {
        Metrics.PushSingleMetric("TranscribeBatchCompleted", 1, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName);
        Metrics.PushSingleMetric("TranscribeBatchDurationMs", durationMs, MetricUnit.Milliseconds, nameSpace: MetricNamespace, service: ServiceName);
    }

    public void BatchFailed() =>
        Metrics.PushSingleMetric("TranscribeBatchFailed", 1, MetricUnit.Count, nameSpace: MetricNamespace, service: ServiceName);
}
