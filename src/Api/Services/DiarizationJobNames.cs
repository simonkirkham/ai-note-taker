namespace Api.Services;

// The Transcribe batch job name is the only channel that carries the noteId across to the
// async completion handler (EventBridge "Transcribe Job State Change" → TranscribeCompletion
// Lambda) — there is no job tag in the event. Encode the noteId (32 hex, no hyphens — within
// the job-name charset ^[0-9a-zA-Z._-]+) with a guid suffix for uniqueness, and recover it on
// the way back. Prefix `diarize-` namespaces our jobs from any other Transcribe usage.
public static class DiarizationJobNames
{
    private const string Prefix = "diarize-";
    private const string AnalyseSuffix = "-a";   // re-analyse the diarized transcript on completion
    private const string NoAnalyseSuffix = "-n";  // diarize only (auto-analyse was OFF)

    // 33-B2: the trailing `-a`/`-n` carries the analyse-on-completion intent (the frontend's
    // auto-analyse toggle) — the only channel to the completion Lambda. Appended after the guid so
    // TryGetNoteId (first 32 hex) is untouched, and `ShouldAnalyse` is an unambiguous EndsWith
    // (a guid never ends in `-a`/`-n`).
    public static string For(string noteId, bool analyseOnCompletion) =>
        $"{Prefix}{Guid.Parse(noteId):N}-{Guid.NewGuid():N}{(analyseOnCompletion ? AnalyseSuffix : NoAnalyseSuffix)}";

    public static bool TryGetNoteId(string jobName, out string noteId)
    {
        noteId = "";
        if (string.IsNullOrEmpty(jobName) || !jobName.StartsWith(Prefix, StringComparison.Ordinal))
            return false;
        var rest = jobName.AsSpan(Prefix.Length);
        if (rest.Length < 32 || !Guid.TryParseExact(rest[..32], "N", out var parsed))
            return false;
        noteId = parsed.ToString();
        return true;
    }

    // Whether the completion Lambda should re-analyse this note. A pre-33-B2 job name (no suffix)
    // ends in a guid hex char, so it reads as false — safe (no surprise analysis on an old job).
    public static bool ShouldAnalyse(string jobName) =>
        jobName.EndsWith(AnalyseSuffix, StringComparison.Ordinal);
}
