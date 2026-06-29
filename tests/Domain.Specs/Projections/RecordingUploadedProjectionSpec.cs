using System.Text.Json;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class RecordingUploadedProjectionSpec
{
    private static EventEnvelope Envelope(string streamId, long seq, string type, string payload) =>
        new(streamId, seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void RecordingUploaded_sets_recordingAudioKey()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(RecordingUploaded),
            JsonSerializer.Serialize(new RecordingUploaded(new NoteId(noteId), "recordings/x/take.wav"))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("recordings/x/take.wav", detail!.RecordingAudioKey);
    }

    [Fact]
    public void RecordingUploaded_latest_wins()
    {
        var noteId = Guid.NewGuid();
        var projection = new NoteDetailProjection();

        projection.Handle(Envelope($"note#{noteId}", 1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(new NoteId(noteId)))));
        projection.Handle(Envelope($"note#{noteId}", 2, nameof(RecordingUploaded),
            JsonSerializer.Serialize(new RecordingUploaded(new NoteId(noteId), "recordings/x/old.wav"))));
        projection.Handle(Envelope($"note#{noteId}", 3, nameof(RecordingUploaded),
            JsonSerializer.Serialize(new RecordingUploaded(new NoteId(noteId), "recordings/x/new.wav"))));

        var detail = projection.GetDetail(new NoteId(noteId));
        Assert.Equal("recordings/x/new.wav", detail!.RecordingAudioKey);
    }
}
