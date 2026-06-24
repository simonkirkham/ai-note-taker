using System.Text.Json;
using Domain;
using Domain.Notes;
using EventStore;

namespace TranscribeCompletion;

public interface IDiarizedTranscriptWriter
{
    // True when the diarized event was appended; false when the note is gone/deleted (nothing to do).
    Task<bool> AppendAsync(Guid noteId, string text, int speakerCount, string jobId, string sourceAudioKey,
        CancellationToken ct = default);
}

// Appends TranscriptionDiarized to a note from the async completion handler — outside any HTTP
// scope, so owner/workspace are read from the note's first event (history[0].Metadata), not an
// ICurrentUser. Runs the pure aggregate (load → handle → append) so the blank-text guard and
// existence/deletion checks hold exactly as on the write path. The projector then folds the event
// (latest-wins over TranscriptionCompleted) and sets TranscriptIsDiarized = true.
public sealed class DiarizedTranscriptWriter(IEventStore store) : IDiarizedTranscriptWriter
{
    private const int EventVersion = 1;

    public async Task<bool> AppendAsync(Guid noteId, string text, int speakerCount, string jobId,
        string sourceAudioKey, CancellationToken ct = default)
    {
        var id = new NoteId(noteId);
        var streamId = id.ToStreamId();
        var history = await store.ReadAsync(streamId, ct).ConfigureAwait(false);
        if (history.Count == 0) return false; // note never created (or wrong id) — nothing to update

        var note = Rebuild(history);
        if (!note.Exists) return false; // deleted — never resurrect

        var events = note.Handle(new RecordDiarizedTranscription(id, text, speakerCount, jobId, sourceAudioKey));
        if (events.Count == 0) return false;

        var meta = history[0].Metadata;
        var envelopes = events.Select(e => new EventEnvelope(
            StreamId: streamId, SequenceNumber: 0, EventType: e.GetType().Name, EventVersion: EventVersion,
            OccurredAt: DateTimeOffset.UtcNow, Payload: JsonSerializer.Serialize(e, e.GetType()),
            Metadata: new EventMetadata(Guid.NewGuid(), meta.UserId, null, null, meta.WorkspaceId))).ToList();
        await store.AppendAsync(streamId, history.Count, envelopes, ct).ConfigureAwait(false);
        return true;
    }

    private static Note Rebuild(IReadOnlyList<EventEnvelope> history)
    {
        var note = new Note();
        foreach (var e in history)
            note.Apply(EventDeserializer.Deserialize(e));
        return note;
    }
}
