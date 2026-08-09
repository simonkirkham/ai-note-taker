using System.Net.Http.Json;
using System.Text.Json;
using Domain.Notes;
using EventStore;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

// Phase 43-H1, C1 — the single property that makes this migration safe to run against real notes:
// a body that moved after the scan is REJECTED, never overwritten.
//
// The migration reads the event stream, so the window is only the duration of the run — but a save
// landing inside it used to be silent data loss: the whole body was replaced with the scanned
// snapshot, and NoteCommandHandler's ConcurrencyException retry re-ran the command and re-applied
// the same stale body. EditContent now carries ExpectedBaseContentHash of exactly what was scanned,
// so the aggregate throws StaleContentEditException instead and the note is reported for a re-run.
[Collection("AgendaMigration")]
public sealed class AgendaMigrationStaleContentTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    [Fact]
    public async Task A_note_saved_between_the_scan_and_the_write_is_reported_stale_not_clobbered()
    {
        const string typedMeanwhile = "The paragraph the user typed while the migration was running.";
        var racing = new RacingEventStore();
        var custom = _factory.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IEventStore>();
            s.AddSingleton<IEventStore>(sp =>
            {
                // The interposed save goes through the PROJECTING decorator, exactly as the user's
                // real save would — appending straight to the inner store would leave the read
                // model behind, and the assertions below would be reading a stale projection
                // rather than the note.
                var decorated = ApiFactory.BuildSyncProjectingStore(sp, racing);
                racing.Outer = decorated;
                return decorated;
            });
        }));
        var client = custom.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);

        var create = await client.PostAsync("/notes", null);
        var noteId = (await create.Content.ReadFromJsonAsync<JsonElement>())
            .GetProperty("noteId").GetString()!;
        await client.PutAsync($"/notes/{noteId}/content",
            JsonContent.Create(new { content = "Original body." }));
        await client.PostAsync($"/notes/{noteId}/agenda-items", JsonContent.Create(new { text = "Travel" }));

        // Arm the race: the migration's scan sees "Original body.", then the user's save lands
        // before the command handler re-reads the stream.
        racing.InterposeOnce($"note#{noteId}", new NoteId(Guid.Parse(noteId)), typedMeanwhile);

        var result = await (await client.PostAsync("/admin/agenda/migrate?apply=true", null))
            .Content.ReadFromJsonAsync<JsonElement>();

        var line = result.GetProperty("notes").EnumerateArray()
            .Single(n => n.GetProperty("noteId").GetString() == noteId.Replace("-", ""));
        Assert.StartsWith("stale", line.GetProperty("outcome").GetString());
        Assert.Equal(1, result.GetProperty("notesStale").GetInt32());
        Assert.Equal(0, result.GetProperty("notesMigrated").GetInt32());
        // The typing survives untouched — no checklist, and nothing rolled back to the scanned body.
        var content = (await client.GetFromJsonAsync<JsonElement>($"/notes/{noteId}"))
            .GetProperty("content").GetString();
        Assert.Equal(typedMeanwhile, content);
        Assert.DoesNotContain("- [ ] Travel", content);
    }

    // Lands the user's save on the stream just before the migration's own APPEND — deliberately not
    // before its read.
    //
    // Interposing at the first ReadAsync (the obvious way, and how this double was first written)
    // proves far less than it appears: the handler's very first read already returns the new
    // content, so the hash fails on attempt 1, no ConcurrencyException is ever raised, and the
    // RETRY LOOP IS NEVER ENTERED — which is precisely the path this slice claims to have fixed.
    // Arming AppendAsync instead makes the migration's append lose the optimistic-concurrency check
    // for real: it throws ConcurrencyException, NoteCommandHandler re-reads and re-runs the command
    // (NoteCommandHandler.cs:71-97), and only then does the freshly-recomputed hash reject it. That
    // is the sequence that used to re-apply the stale body, so that is the sequence under test.
    // Deterministic — no timing.
    //
    // The envelope is built exactly as NoteCommandHandler.ToEnvelopes builds one: the logical v1
    // `ContentEdited` type name at EventVersion 2, carrying a ContentEditedV2 payload.
    private sealed class RacingEventStore : IEventStore
    {
        private readonly InMemoryEventStore _inner = new();
        private string? _armedStream;
        private NoteId _armedNoteId;
        private string? _armedContent;

        // The projecting decorator that wraps this store; the interposed save is appended through
        // it so the read models advance with it, as a real save would.
        public IEventStore? Outer { get; set; }

        public void InterposeOnce(string streamId, NoteId noteId, string content)
        {
            _armedStream = streamId;
            _armedNoteId = noteId;
            _armedContent = content;
        }

        public async Task AppendAsync(string streamId, long expectedVersion,
            IReadOnlyList<EventEnvelope> events, CancellationToken ct = default)
        {
            if (streamId == _armedStream && _armedContent is { } content)
            {
                _armedStream = null;
                _armedContent = null;
                var history = await _inner.ReadAsync(streamId, ct).ConfigureAwait(false);
                var envelope = new EventEnvelope(
                    StreamId: streamId, SequenceNumber: 0, EventType: nameof(ContentEdited),
                    EventVersion: 2, OccurredAt: DateTimeOffset.UtcNow,
                    Payload: JsonSerializer.Serialize(
                        new ContentEditedV2(_armedNoteId, content, content.Length)),
                    Metadata: new EventMetadata(Guid.NewGuid(), FakeCurrentUser.TestUserId, null, null));
                await (Outer ?? _inner).AppendAsync(streamId, history.Count, [envelope], ct)
                    .ConfigureAwait(false);
                // The caller's expectedVersion is now behind, so this append conflicts for real.
            }
            await _inner.AppendAsync(streamId, expectedVersion, events, ct).ConfigureAwait(false);
        }

        public Task<IReadOnlyList<EventEnvelope>> ReadAsync(string streamId, CancellationToken ct = default) =>
            _inner.ReadAsync(streamId, ct);

        public Task<IReadOnlyList<EventEnvelope>> ReadAllStreamsAsync(CancellationToken ct = default) =>
            _inner.ReadAllStreamsAsync(ct);
    }
}
