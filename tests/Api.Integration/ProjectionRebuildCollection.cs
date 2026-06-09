namespace Api.Integration;

// Tests that POST /admin/projections/rebuild share this collection so they run sequentially.
// The rebuild handler's single-flight lock is process-wide (static), so two rebuilds in parallel
// would correctly reject one with 409 — serialising avoids that collision in the suite while
// preserving the production guard.
[CollectionDefinition("ProjectionRebuild")]
public sealed class ProjectionRebuildCollection
{
}
