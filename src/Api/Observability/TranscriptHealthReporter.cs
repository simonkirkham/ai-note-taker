using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Api.Observability;

// TI-99: turns the client's transcript-health block into one log line plus the coverage/stall
// metrics. Everything in the block is untrusted input, so strings are whitelisted or truncated and
// numbers clamped before they reach a log or a metric. The transcript text is never passed in.
// A field of the wrong type is dropped and named in `malformed=`; it never fails the save.
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

    public static bool IsPresent(JsonElement? health) =>
        health is { ValueKind: not (JsonValueKind.Null or JsonValueKind.Undefined) };

    public static void Report(ILogger logger, IDomainMetrics metrics, string phase, Guid noteId, int durationSeconds, JsonElement? healthJson)
    {
        if (!IsPresent(healthJson))
        {
            if (phase == CompletePhase)
                logger.LogInformation("Transcript health {Phase} note {NoteId}: health: absent", phase, noteId);
            return;
        }

        var health = HealthFields.Parse(healthJson!.Value);
        var endReason = Whitelist(health.EndReason, EndReasons);
        var engine = Whitelist(health.Engine, Engines);
        var duration = (int)Clamp(durationSeconds);
        var covered = ClampRounded(health.CoveredSeconds, 1);
        double? ratio = covered is { } c && duration > 0 ? Math.Round(Math.Min(c / duration, 1), 2) : null;
        var isComplete = phase == CompletePhase;
        var longRecording = duration >= CoverageMinDurationSeconds;

        // BUG-85: a dead capture source or silent audio is a fault whatever the end reason says —
        // the 2026-09-17 recording reported `inProgress` for three and a half hours while producing
        // nothing. Both deserve a Warning on their own.
        var warn = WarningEndReasons.Contains(endReason)
            || health.SourceEnded == true
            || health.AudioSilent == true
            || (isComplete && longRecording && ratio < LowCoverageRatio)
            || health.Malformed.Count > 0;

        logger.Log(warn ? LogLevel.Warning : LogLevel.Information,
            "Transcript health {Phase} note {NoteId}: end={EndReason} covered={CoveredSeconds}s of {DurationSeconds}s ratio={Ratio} sinceLastText={SecondsSinceLastText}s audioSent={AudioSecondsSent}s sinceLastAudio={SecondsSinceLastAudio}s streams={StreamCount} engine={Engine} sourceEnded={SourceEnded} muted={SourceMuted} silent={AudioSilent} silentFor={SecondsSilent}s error={ErrorName}: {ErrorMessage}{Malformed}",
            phase, noteId, endReason,
            OrAbsent(covered), duration, OrAbsent(ratio),
            OrAbsent(ClampRounded(health.SecondsSinceLastText, 0)),
            OrAbsent(ClampRounded(health.AudioSecondsSent, 0)),
            OrAbsent(ClampRounded(health.SecondsSinceLastAudio, 0)),
            OrAbsent(health.StreamCount is { } n ? (int?)Clamp(n) : null),
            engine,
            OrAbsent(health.SourceEnded),
            OrAbsent(health.SourceMuted),
            OrAbsent(health.AudioSilent),
            OrAbsent(ClampRounded(health.SecondsSilent, 0)),
            Sanitise(health.ErrorName) ?? Absent,
            Sanitise(health.ErrorMessage) ?? Absent,
            health.Malformed.Count > 0 ? $" malformed={string.Join(",", health.Malformed)}" : "");

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

    // Control, line/paragraph-separator and bidi-override characters are dropped as well as the
    // length cut, so a hostile message cannot forge extra lines or disguise itself in a log view.
    private static string? Sanitise(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        var clean = new string(value.Where(IsSafe).Take(MaxStringLength).ToArray());
        return clean.Length == 0 ? null : clean;
    }

    private static bool IsSafe(char ch) =>
        !char.IsControl(ch)
        && CharUnicodeInfo.GetUnicodeCategory(ch) is not (UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
        && ch is not ('\u061C' or '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069'));

    private sealed class HealthFields
    {
        public string? Engine { get; private set; }
        public string? EndReason { get; private set; }
        public string? ErrorName { get; private set; }
        public string? ErrorMessage { get; private set; }
        public double? CoveredSeconds { get; private set; }
        public double? SecondsSinceLastText { get; private set; }
        public double? AudioSecondsSent { get; private set; }
        public double? SecondsSinceLastAudio { get; private set; }
        public int? StreamCount { get; private set; }
        // BUG-85: what was actually in the captured audio, as opposed to how much of it was sent.
        public bool? SourceEnded { get; private set; }
        public bool? SourceMuted { get; private set; }
        public bool? AudioSilent { get; private set; }
        public double? SecondsSilent { get; private set; }
        public List<string> Malformed { get; } = [];

        public static HealthFields Parse(JsonElement json)
        {
            var fields = new HealthFields();
            if (json.ValueKind != JsonValueKind.Object)
            {
                fields.Malformed.Add("health");
                return fields;
            }
            fields.Engine = fields.Text(json, "engine");
            fields.EndReason = fields.Text(json, "endReason");
            fields.ErrorName = fields.Text(json, "errorName");
            fields.ErrorMessage = fields.Text(json, "errorMessage");
            fields.CoveredSeconds = fields.Number(json, "coveredSeconds");
            fields.SecondsSinceLastText = fields.Number(json, "secondsSinceLastText");
            fields.AudioSecondsSent = fields.Number(json, "audioSecondsSent");
            fields.SecondsSinceLastAudio = fields.Number(json, "secondsSinceLastAudio");
            fields.StreamCount = fields.WholeNumber(json, "streamCount");
            fields.SourceEnded = fields.Flag(json, "sourceEnded");
            fields.SourceMuted = fields.Flag(json, "sourceMuted");
            fields.AudioSilent = fields.Flag(json, "audioSilent");
            fields.SecondsSilent = fields.Number(json, "secondsSilent");
            return fields;
        }

        private static JsonElement? Field(JsonElement json, string name) =>
            json.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null ? value : null;

        private string? Text(JsonElement json, string name)
        {
            if (Field(json, name) is not { } value) return null;
            if (value.ValueKind == JsonValueKind.String) return value.GetString();
            Malformed.Add(name);
            return null;
        }

        private double? Number(JsonElement json, string name)
        {
            if (Field(json, name) is not { } value) return null;
            // A JSON number beyond double range (1e400) reads back as Infinity, so finiteness is checked too.
            if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var d) && double.IsFinite(d)) return d;
            Malformed.Add(name);
            return null;
        }

        // Absent on a build from before BUG-85, which must keep working — so an absent flag stays
        // null and reads as "-", never as false.
        private bool? Flag(JsonElement json, string name)
        {
            if (Field(json, name) is not { } value) return null;
            if (value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.GetBoolean();
            Malformed.Add(name);
            return null;
        }

        private int? WholeNumber(JsonElement json, string name)
        {
            if (Field(json, name) is not { } value) return null;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var n)) return n;
            Malformed.Add(name);
            return null;
        }
    }
}
