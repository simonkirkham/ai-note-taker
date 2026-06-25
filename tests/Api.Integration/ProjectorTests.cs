using System.Text.Json;
using Amazon.Lambda.DynamoDBEvents;
using Domain;
using Domain.Notes;
using Domain.Todos;
using EventStore;
using EventStore.Projections;
using Api.Projections;
using Projector;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// 27-B: the async projector engine rebuilds read models off the event log via the shared
// ProjectionUpdater, gated by the processed-position guard. The headline guarantee is the
// one 27-A could not give: a redelivered stream does not double-apply the increment-based
// feedback counters.
public sealed class ProjectorTests
{
    private const string UserId = "user-1";
    private const string WorkspaceId = "ws-1";

    private readonly InMemoryEventStore _events = new();
    private readonly InMemoryNoteTitleListStore _titleStore = new();
    private readonly InMemoryNoteDetailStore _detailStore = new();
    private readonly InMemoryTodoListStore _todoStore = new();
    private readonly InMemoryNoteCardListStore _cardStore = new();
    private readonly InMemoryNoteActionsStore _actionsStore = new();
    private readonly InMemoryTagIndexStore _tagIndexStore = new();
    private readonly InMemoryTagFeedbackStore _tagFeedbackStore = new();
    private readonly InMemoryActionItemFeedbackStore _actionFeedbackStore = new();
    private readonly InMemoryCalendarLinkIndexStore _calendarLinkStore = new();
    private readonly InMemoryNoteSearchViewStore _searchStore = new();
    private readonly InMemoryFolderTreeStore _folderStore = new();
    private readonly InMemoryWorkspaceListStore _workspaceStore = new();
    private readonly FakeNoteImageStore _imageStore = new();
    private readonly InMemoryProcessedPositionStore _positions = new();
    private readonly CountingProjectorMetrics _metrics = new();

    private StreamProjector NewProjector()
    {
        var updater = new ProjectionUpdater(
            _titleStore, _detailStore, _todoStore, _cardStore, _actionsStore,
            _tagIndexStore, _tagFeedbackStore, _actionFeedbackStore, _calendarLinkStore,
            _searchStore, _folderStore, _workspaceStore, _imageStore,
            NullLogger<ProjectionUpdater>.Instance);
        return new StreamProjector(_events, updater, _positions, _metrics, NullLogger<StreamProjector>.Instance);
    }

    [Fact]
    public void Mapper_returns_streamId_for_event_row_and_filters_meta_and_remove()
    {
        Assert.Equal("note#abc", StreamRecordMapper.TryGetEventStreamId(EventRow("note#abc", "v00000001")));
        Assert.Null(StreamRecordMapper.TryGetEventStreamId(EventRow("note#abc", "META#stream")));
        Assert.Null(StreamRecordMapper.TryGetEventStreamId(RemoveRow()));
    }

    [Fact]
    public async Task Note_stream_projects_title_and_card()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(), new NoteCreated(noteId), new NoteRenamed(noteId, "Title"));

        await NewProjector().ProcessStreamsAsync([noteId.ToStreamId()]);

        Assert.Equal("Title", Assert.Single((await _titleStore.QueryAllAsync()).Items).Title);
        Assert.Equal("Title", (await _cardStore.GetByNoteAsync(noteId))!.Title);
        Assert.Equal(1, _metrics.AppliedCalls);
    }

    [Fact]
    public async Task Projection_is_absent_before_processing_and_present_after()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(), new NoteCreated(noteId), new NoteRenamed(noteId, "Title"));

        // RYW: an append does NOT build the projection — it lags until the projector runs. This
        // is the read-after-write window the consistency gate waits on before answering a read.
        Assert.Empty((await _titleStore.QueryAllAsync()).Items);

        await NewProjector().ProcessStreamsAsync([noteId.ToStreamId()]);

        Assert.Equal("Title", Assert.Single((await _titleStore.QueryAllAsync()).Items).Title);
    }

    [Fact]
    public async Task Todo_stream_projects_todo()
    {
        var todoId = new TodoId(Guid.NewGuid());
        await AppendAsync(todoId.ToStreamId(), new TodoAdded(todoId, UserId, "buy milk", null));

        await NewProjector().ProcessStreamsAsync([todoId.ToStreamId()]);

        Assert.Single((await _todoStore.QueryAllAsync()).Items);
    }

    [Fact]
    public async Task Redelivered_stream_does_not_double_count_feedback()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(),
            new NoteCreated(noteId),
            new TagsSuggested(noteId, ["alpha", "beta"]));

        await NewProjector().ProcessStreamsAsync([noteId.ToStreamId()]);
        var afterFirst = (await _tagFeedbackStore.GetAllAsync()).Sum(v => v.SuggestedCount);

        // Redeliver the same stream — the position guard must skip it.
        await NewProjector().ProcessStreamsAsync([noteId.ToStreamId()]);
        var afterSecond = (await _tagFeedbackStore.GetAllAsync()).Sum(v => v.SuggestedCount);

        Assert.Equal(2, afterFirst);
        Assert.Equal(afterFirst, afterSecond);
        Assert.True(_metrics.DuplicateSkippedCalls >= 1);
    }

    [Fact]
    public async Task Unknown_stream_prefix_is_skipped_not_thrown()
    {
        await AppendAsync("mystery#1", new NoteCreated(new NoteId(Guid.NewGuid())));

        var ex = await Record.ExceptionAsync(() => NewProjector().ProcessStreamsAsync(["mystery#1"]));

        Assert.Null(ex);
        Assert.Empty((await _titleStore.QueryAllAsync()).Items);
    }

    [Fact]
    public async Task Apply_failure_propagates_and_does_not_advance_position()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(), new NoteCreated(noteId));
        var projector = new StreamProjector(_events, new ThrowingUpdater(), _positions, _metrics, NullLogger<StreamProjector>.Instance);

        // A failed apply must surface (so the ESM bisects/DLQs) and must NOT advance the
        // position mark — otherwise the retried record would be skipped and silently lost.
        await Assert.ThrowsAsync<InvalidOperationException>(() => projector.ProcessStreamsAsync([noteId.ToStreamId()]));

        Assert.Equal(-1, await _positions.GetLastSeqAsync(noteId.ToStreamId()));
    }

    [Fact]
    public async Task Handle_records_failure_metric_and_rethrows()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await AppendAsync(noteId.ToStreamId(), new NoteCreated(noteId));
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IEventStore>(_events);
        services.AddSingleton<IProcessedPositionStore>(_positions);
        services.AddSingleton<IProjectorMetrics>(_metrics);
        services.AddSingleton<IProjectionUpdater>(new ThrowingUpdater());
        services.AddSingleton<StreamProjector>();
        var function = new ProjectorFunction(services.BuildServiceProvider());
        var evt = new DynamoDBEvent { Records = [EventRow(noteId.ToStreamId(), "v00000001")] };

        await Assert.ThrowsAsync<InvalidOperationException>(() => function.Handle(evt, null!));

        Assert.Equal(1, _metrics.FailureCalls);
    }

    private async Task AppendAsync(string streamId, params IDomainEvent[] events)
    {
        var existing = await _events.ReadAsync(streamId);
        var envelopes = events.Select(e => Envelope(streamId, e)).ToList();
        await _events.AppendAsync(streamId, existing.Count, envelopes);
    }

    private static EventEnvelope Envelope(string streamId, IDomainEvent e) => new(
        streamId, 0, e.GetType().Name, 1, DateTimeOffset.UtcNow,
        JsonSerializer.Serialize(e, e.GetType()),
        new EventMetadata(Guid.NewGuid(), UserId, null, null, WorkspaceId));

    private static DynamoDBEvent.DynamodbStreamRecord EventRow(string pk, string sk) => new()
    {
        Dynamodb = new DynamoDBEvent.StreamRecord
        {
            NewImage = new Dictionary<string, DynamoDBEvent.AttributeValue>
            {
                ["PK"] = new() { S = pk },
                ["SK"] = new() { S = sk }
            }
        }
    };

    private static DynamoDBEvent.DynamodbStreamRecord RemoveRow() => new()
    {
        Dynamodb = new DynamoDBEvent.StreamRecord { NewImage = null }
    };

    private sealed class ThrowingUpdater : IProjectionUpdater
    {
        public Task ApplyNoteEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, List<EventEnvelope> newEnvelopes, CancellationToken ct) => throw new InvalidOperationException("boom");
        public Task ApplyActionItemEventsAsync(NoteId noteId, IReadOnlyList<EventEnvelope> history, IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct) => throw new InvalidOperationException("boom");
        public Task ApplyTodoEventsAsync(IReadOnlyList<IDomainEvent> newEvents, List<EventEnvelope> newEnvelopes, CancellationToken ct) => throw new InvalidOperationException("boom");
        public Task ApplyFolderEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct) => throw new InvalidOperationException("boom");
        public Task ApplyWorkspaceEventsAsync(List<EventEnvelope> newEnvelopes, CancellationToken ct) => throw new InvalidOperationException("boom");
    }

    private sealed class CountingProjectorMetrics : IProjectorMetrics
    {
        public int AppliedCalls;
        public int DuplicateSkippedCalls;
        public int FailureCalls;
        public void Applied(int count) => AppliedCalls++;
        public void Lag(double milliseconds) { }
        public void Failure() => FailureCalls++;
        public void DuplicateSkipped() => DuplicateSkippedCalls++;
    }
}
