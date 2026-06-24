using System.Text.Json;

namespace TranscribeCompletion;

public sealed record DiarizedTranscript(string Text, int SpeakerCount);

// Turns an Amazon Transcribe BATCH result JSON into the same "Speaker N: …" text the live
// streaming path produces (web/src/hooks/speakerSegments.ts) — so the diarized transcript reads
// identically to the streamed one, only cleaner. Batch differs from streaming in two ways the
// parser reconciles: speakers are labelled `spk_0` (mapped to the 0-based id streaming uses, so
// `spk_0` → "Speaker 1"), and each word's speaker is looked up by start_time from
// `speaker_labels.segments[].items[]` rather than carried on the item itself.
public static class TranscribeResultParser
{
    public static DiarizedTranscript Parse(string resultJson)
    {
        using var doc = JsonDocument.Parse(resultJson);
        var results = doc.RootElement.GetProperty("results");

        var speakerByStart = BuildSpeakerByStart(results);
        var segments = new List<(string Speaker, string Text)>();
        var speakers = new HashSet<string>();

        foreach (var item in results.GetProperty("items").EnumerateArray())
        {
            var content = item.TryGetProperty("alternatives", out var alts) && alts.GetArrayLength() > 0
                ? alts[0].GetProperty("content").GetString() ?? ""
                : "";
            if (content.Length == 0) continue;

            var isPunctuation = item.TryGetProperty("type", out var t) && t.GetString() == "punctuation";
            // Group consecutive same-speaker words; punctuation attaches to the current run with no
            // leading space and never starts a new run — mirrors groupBySpeaker().
            if (isPunctuation)
            {
                if (segments.Count == 0) continue; // nothing to attach to → drop
                ref var lastP = ref System.Runtime.InteropServices.CollectionsMarshal.AsSpan(segments)[^1];
                lastP.Text += content;
                continue;
            }

            var speaker = item.TryGetProperty("start_time", out var st)
                          && speakerByStart.TryGetValue(st.GetString() ?? "", out var s)
                ? s
                : "?";
            speakers.Add(speaker);
            if (segments.Count > 0 && segments[^1].Speaker == speaker)
            {
                ref var last = ref System.Runtime.InteropServices.CollectionsMarshal.AsSpan(segments)[^1];
                last.Text += $" {content}";
            }
            else
            {
                segments.Add((speaker, content));
            }
        }

        var text = string.Join("\n", segments.Select(seg => $"{Label(seg.Speaker)}: {seg.Text}"));
        var speakerCount = results.TryGetProperty("speaker_labels", out var sl)
                           && sl.TryGetProperty("speakers", out var cnt) && cnt.TryGetInt32(out var c)
            ? c
            : speakers.Count;
        return new DiarizedTranscript(text, speakerCount);
    }

    // start_time → 0-based speaker id, from the per-word entries in speaker_labels.segments.
    private static Dictionary<string, string> BuildSpeakerByStart(JsonElement results)
    {
        var map = new Dictionary<string, string>();
        if (!results.TryGetProperty("speaker_labels", out var sl)
            || !sl.TryGetProperty("segments", out var segs))
            return map;
        foreach (var seg in segs.EnumerateArray())
        {
            if (!seg.TryGetProperty("items", out var items)) continue;
            foreach (var it in items.EnumerateArray())
            {
                if (it.TryGetProperty("start_time", out var st) && it.TryGetProperty("speaker_label", out var spk))
                    map[st.GetString() ?? ""] = NormalizeSpeaker(spk.GetString() ?? "");
            }
        }
        return map;
    }

    // `spk_0` → `0` (the 0-based id streaming uses); anything else is passed through.
    private static string NormalizeSpeaker(string label) =>
        label.StartsWith("spk_", StringComparison.Ordinal) ? label["spk_".Length..] : label;

    // 0-based speaker id → 1-based human label, identical to speakerLabel() in the frontend.
    private static string Label(string speaker) =>
        int.TryParse(speaker, out var n) ? $"Speaker {n + 1}" : $"Speaker {speaker}";
}
