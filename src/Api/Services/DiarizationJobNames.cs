namespace Api.Services;

// The Transcribe batch job name is the only channel that carries the noteId across to the
// async completion handler (EventBridge "Transcribe Job State Change" → TranscribeCompletion
// Lambda) — there is no job tag in the event. Encode the noteId (32 hex, no hyphens — within
// the job-name charset ^[0-9a-zA-Z._-]+) with a guid suffix for uniqueness, and recover it on
// the way back. Prefix `diarize-` namespaces our jobs from any other Transcribe usage.
public static class DiarizationJobNames
{
    private const string Prefix = "diarize-";

    public static string For(string noteId) =>
        $"{Prefix}{Guid.Parse(noteId):N}-{Guid.NewGuid():N}";

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
}
