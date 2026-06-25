using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class TranscriptionDiarizedProjectionSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void TranscriptionDiarized_replaces_transcript_and_sets_flag()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(TranscriptionCompleted),
            JsonSerializer.Serialize(new TranscriptionCompleted(new NoteId(noteId), "streamed words", 10))));
        projection.Handle(Envelope($"note#{noteId}", 3, nameof(TranscriptionDiarized),
            JsonSerializer.Serialize(new TranscriptionDiarized(new NoteId(noteId), "Speaker 1: streamed words", 1, "job-1", "recordings/x/take.wav"))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("Speaker 1: streamed words", detail!.TranscriptText);
        Assert.True(detail.TranscriptIsDiarized);
    }

    [Fact]
    public void Without_diarization_flag_is_false()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(TranscriptionCompleted),
            JsonSerializer.Serialize(new TranscriptionCompleted(new NoteId(noteId), "streamed words", 10))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.False(detail!.TranscriptIsDiarized);
    }
}
