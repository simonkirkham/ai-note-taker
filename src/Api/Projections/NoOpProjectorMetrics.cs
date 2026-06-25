namespace Api.Projections;

// In-process hosts (test harness + local Kestrel) drive the projector synchronously for
// read-after-write consistency, not for observability — its EMF metrics would be noise off
// Lambda (no metrics sink), so swallow them.
public sealed class NoOpProjectorMetrics : IProjectorMetrics
{
    public void Applied(int count) { }
    public void Lag(double milliseconds) { }
    public void Failure() { }
    public void DuplicateSkipped() { }
}
