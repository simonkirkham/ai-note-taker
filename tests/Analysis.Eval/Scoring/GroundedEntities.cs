namespace Analysis.Eval.Scoring;

// MPI-5: builds the deterministic grounded-entity allowlist handed to the quality judge.
// The fixture's gold tags are the human-curated set of entities the note SHOULD surface, so
// they are grounded by definition — the judge must never count them as fabrication. Kebab
// gold tags ("stark-industries") are humanised ("stark industries") so they read as the
// entities they name. This replaces the prompt-only grounding of MPI-4, which still let the
// judge mis-flag note/gold entities (run-28225, 14-all-hands-reorg).
public static class GroundedEntities
{
    public static IReadOnlyList<string> From(Fixture fixture) =>
        fixture.Expected.Tags
            .Select(Humanise)
            .Where(e => e.Length > 0)
            .Distinct()
            .ToList();

    static string Humanise(string tag) => tag.Replace('-', ' ').Trim();
}
