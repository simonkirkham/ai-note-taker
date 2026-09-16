using Api.Contracts;
using Microsoft.Extensions.Logging;

namespace Api.Observability;

// TI-99: turns the client's transcript-health block into one log line plus the coverage/stall
// metrics. Everything in the block is untrusted input, so strings are whitelisted or truncated and
// numbers clamped before they reach a log or a metric. The transcript text is never passed in.
public static class TranscriptHealthReporter
{
    public const string CompletePhase = "complete";
    public const string DraftPhase = "draft";

    private const double MaxSeconds = 86_400;
    private const int MaxStringLength = 200;
    private const double LowCoverageRatio = 0.8;
    private const int CoverageMinDurationSeconds = 300;
    private const string Absent = "-";

    private static readonly HashSet<string> EndReasons =
        ["stopped", "error", "streamEnded", "inProgress", "stalled"];

    private static readonly HashSet<string> WarningEndReasons = ["error", "stalled", "streamEnded"];

    private static readonly HashSet<string> Engines = ["cloud", "local"];

    public static void Report(ILogger logger, IDomainMetrics metrics, string phase, Guid noteId, int durationSeconds, TranscriptHealth? health)
    {
        if (health is null)
        {
            if (phase == CompletePhase)
                logger.LogInformation("Transcript health {Phase} note {NoteId}: health: absent", phase, noteId);
            return;
        }

        var endReason = Whitelist(health.EndReason, EndReasons);
        var engine = Whitelist(health.Engine, Engines);
        var duration = (int)Clamp(durationSeconds);
        var covered = ClampRounded(health.CoveredSeconds, 1);
        double? ratio = covered is { } c && duration > 0 ? Math.Round(Math.Min(c / duration, 1), 2) : null;
        var isComplete = phase == CompletePhase;
        var longRecording = duration >= CoverageMinDurationSeconds;

        var warn = WarningEndReasons.Contains(endReason)
            || (isComplete && longRecording && ratio < LowCoverageRatio);

        logger.Log(warn ? LogLevel.Warning : LogLevel.Information,
            "Transcript health {Phase} note {NoteId}: end={EndReason} covered={CoveredSeconds}s of {DurationSeconds}s ratio={Ratio} sinceLastText={SecondsSinceLastText}s audioSent={AudioSecondsSent}s sinceLastAudio={SecondsSinceLastAudio}s streams={StreamCount} engine={Engine} error={ErrorName}: {ErrorMessage}",
            phase, noteId, endReason,
            OrAbsent(covered), duration, OrAbsent(ratio),
            OrAbsent(ClampRounded(health.SecondsSinceLastText, 0)),
            OrAbsent(ClampRounded(health.AudioSecondsSent, 0)),
            OrAbsent(ClampRounded(health.SecondsSinceLastAudio, 0)),
            OrAbsent(health.StreamCount is { } n ? (int?)Clamp(n) : null),
            engine,
            Truncate(health.ErrorName) ?? Absent,
            Truncate(health.ErrorMessage) ?? Absent);

        if (isComplete && longRecording && ratio is { } r)
            metrics.TranscriptCoverage(r);
        if (!isComplete && endReason == "stalled")
            metrics.TranscriptStalled();
    }

    private static string Whitelist(string? value, HashSet<string> allowed) =>
        value is not null && allowed.Contains(value) ? value : "unknown";

    private static double Clamp(double value) =>
        double.IsNaN(value) ? 0 : Math.Clamp(value, 0, MaxSeconds);

    private static double? ClampRounded(double? value, int decimals) =>
        value is { } v ? Math.Round(Clamp(v), decimals) : null;

    private static object OrAbsent<T>(T? value) where T : struct => value is { } v ? v : Absent;

    // Control characters are dropped as well as the length cut, so a hostile message cannot forge
    // extra lines in a plain-text log view.
    private static string? Truncate(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var clean = new string(value.Where(ch => !char.IsControl(ch)).Take(MaxStringLength).ToArray());
        return clean.Length == 0 ? null : clean;
    }
}
