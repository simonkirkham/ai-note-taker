namespace Browser.E2E;

// Hard per-test timeout for every E2E journey. A single browser-driven test must never be able to hang
// the whole deploy gate again — PR #291's fire-and-forget response-body read hung the suite for 44 min
// before it was cancelled by hand. 120 s sits safely above the worst legitimate case (~90 s for the
// Tags journeys, which chain 2-3 reload-tolerant 30 s waits on a cold projector), so it never fails a
// healthy test, while capping any genuine hang at 2 min.
//
// xUnit's Timeout is honoured only when test parallelization is NOT disabled; this assembly uses the
// default (a single "E2E Journeys" collection runs serially, but parallelization is not disabled), and
// enforcement is verified by TimeoutEnforcementProbe.
public sealed class E2EFactAttribute : FactAttribute
{
    public E2EFactAttribute() => Timeout = 120_000;
}
