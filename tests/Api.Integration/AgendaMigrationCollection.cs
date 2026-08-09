namespace Api.Integration;

// Tests that POST /admin/agenda/migrate share this collection so they run sequentially. The
// migration handler's single-flight lock is process-wide (static), so two runs in parallel would
// correctly reject one with 409 — serialising avoids that collision in the suite while preserving
// the production guard. Same reasoning as ProjectionRebuildCollection.
[CollectionDefinition("AgendaMigration")]
public sealed class AgendaMigrationCollection
{
}
