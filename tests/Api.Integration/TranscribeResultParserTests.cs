using TranscribeCompletion;
using Xunit;

namespace Api.Integration;

// The batch parser must yield the SAME "Speaker N: …" shape the live streaming path produces
// (web/src/hooks/speakerSegments.ts), so a diarized note reads identically to a streamed one.
public sealed class TranscribeResultParserTests
{
    // Two speakers, punctuation, a speaker switch and back — the realistic shape.
    private const string TwoSpeakerJson = """
    {
      "results": {
        "speaker_labels": {
          "speakers": 2,
          "segments": [
            { "items": [
              { "start_time": "0.0", "speaker_label": "spk_0" },
              { "start_time": "0.5", "speaker_label": "spk_0" }
            ] },
            { "items": [
              { "start_time": "1.0", "speaker_label": "spk_1" }
            ] },
            { "items": [
              { "start_time": "1.5", "speaker_label": "spk_0" }
            ] }
          ]
        },
        "items": [
          { "type": "pronunciation", "start_time": "0.0", "alternatives": [ { "content": "Hello" } ] },
          { "type": "pronunciation", "start_time": "0.5", "alternatives": [ { "content": "there" } ] },
          { "type": "punctuation", "alternatives": [ { "content": "." } ] },
          { "type": "pronunciation", "start_time": "1.0", "alternatives": [ { "content": "Hi" } ] },
          { "type": "punctuation", "alternatives": [ { "content": "!" } ] },
          { "type": "pronunciation", "start_time": "1.5", "alternatives": [ { "content": "Bye" } ] }
        ]
      }
    }
    """;

    [Fact]
    public void Parse_TwoSpeakers_ProducesSpeakerLabelledLines()
    {
        var result = TranscribeResultParser.Parse(TwoSpeakerJson);

        Assert.Equal("Speaker 1: Hello there.\nSpeaker 2: Hi!\nSpeaker 1: Bye", result.Text);
        Assert.Equal(2, result.SpeakerCount);
    }

    [Fact]
    public void Parse_PunctuationAttachesToCurrentSpeakerWithoutSpace()
    {
        var result = TranscribeResultParser.Parse(TwoSpeakerJson);
        Assert.Contains("Hello there.", result.Text);
        Assert.DoesNotContain("there .", result.Text);
    }

    [Fact]
    public void Parse_NoSpeakerLabels_FallsBackToCountingDistinctSpeakers()
    {
        const string json = """
        {
          "results": {
            "items": [
              { "type": "pronunciation", "start_time": "0.0", "alternatives": [ { "content": "Solo" } ] }
            ]
          }
        }
        """;
        var result = TranscribeResultParser.Parse(json);
        // No speaker map → unknown speaker "?", one distinct.
        Assert.Equal("Speaker ?: Solo", result.Text);
        Assert.Equal(1, result.SpeakerCount);
    }

    [Fact]
    public void Parse_EmptyItems_YieldsEmptyText()
    {
        const string json = """{ "results": { "items": [] } }""";
        var result = TranscribeResultParser.Parse(json);
        Assert.Equal("", result.Text);
    }
}
