using System.Text.Json;
using Domain;
using Domain.ActionItems;
using Domain.Folders;
using Domain.Notes;
using Domain.Todos;
using Domain.Workspaces;
using EventStore;
using EventStore.Projections;
using Api.Projections;
using Microsoft.Extensions.Logging.Abstractions;

namespace Api.Integration;

// 27-A: applying a freshly-appended batch twice must leave the naturally-idempotent and
// made-idempotent read models in the same state as applying it once. The increment-based
// feedback counters are explicitly OUT OF SCOPE here (their redelivery guard is 27-B), so
// none of these assertions touches the feedback stores.
public sealed class ProjectionUpdaterIdempotencyTests
{
    private const string UserId = "user-1";
    private const string WorkspaceId = "ws-1";

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

    private ProjectionUpdater NewUpdater() => new(
        _titleStore, _detailStore, _todoStore, _cardStore, _actionsStore,
        _tagIndexStore, _tagFeedbackStore, _actionFeedbackStore, _calendarLinkStore,
        _searchStore, _folderStore, _workspaceStore,
        _imageStore, NullLogger<ProjectionUpdater>.Instance);

    [Fact]
    public async Task Note_create_rename_tag_content_batch_is_apply_twice_idempotent()
    {
        var noteId = new NoteId(Guid.NewGuid());
        var batch = new List<EventEnvelope>
        {
            Envelope(noteId.ToStreamId(), new NoteCreated(noteId)),
            Envelope(noteId.ToStreamId(), new NoteRenamed(noteId, "Title")),
            Envelope(noteId.ToStreamId(), new NoteTagged(noteId, "alpha")),
            ContentEditedEnvelope(noteId, "the body text"),
        };

        var updater = NewUpdater();
        await updater.ApplyNoteEventsAsync(noteId, [], batch, default);

        await updater.ApplyNoteEventsAsync(noteId, [], batch, default);

        var title = Assert.Single((await _titleStore.QueryAllAsync()).Items);
        Assert.Equal("Title", title.Title);
        var card = await _cardStore.GetByNoteAsync(noteId);
        Assert.Equal("Title", card!.Title);
        Assert.Equal("the body text", card.Content);
        Assert.Equal(["alpha"], card.Tags!);
        var detail = await _detailStore.GetAsync(noteId);
        Assert.Equal("the body text", detail!.Content);
        var search = await _searchStore.GetByNoteIdAsync(noteId);
        Assert.Equal("the body text", search!.Body);
        Assert.Equal(["alpha"], search.Tags);
        Assert.Single(await _tagIndexStore.GetAllAsync());
    }

    [Fact]
    public async Task Card_tag_append_is_add_if_absent_on_redelivery()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await SeedCardAsync(noteId);
        var tagBatch = new List<EventEnvelope> { Envelope(noteId.ToStreamId(), new NoteTagged(noteId, "alpha")) };
        var history = new List<EventEnvelope> { Envelope(noteId.ToStreamId(), new NoteCreated(noteId)) };

        var updater = NewUpdater();
        await updater.ApplyNoteEventsAsync(noteId, history, tagBatch, default);
        await updater.ApplyNoteEventsAsync(noteId, history, tagBatch, default);

        Assert.Equal(["alpha"], (await _cardStore.GetByNoteAsync(noteId))!.Tags!);
    }

    [Fact]
    public async Task Card_action_item_add_is_add_if_absent_on_redelivery()
    {
        var noteId = new NoteId(Guid.NewGuid());
        await SeedCardAsync(noteId);
        await _detailStore.UpsertAsync(NewDetail(noteId));
        var actionId = new ActionId(Guid.NewGuid());
        var added = new ActionItemAdded(actionId, noteId, "do the thing");
        IReadOnlyList<IDomainEvent> newEvents = [added];
        var newEnvelopes = new List<EventEnvelope> { Envelope(actionId.ToStreamId(), added) };

        var updater = NewUpdater();
        await updater.ApplyActionItemEventsAsync(noteId, [], newEvents, newEnvelopes, default);
        await updater.ApplyActionItemEventsAsync(noteId, [], newEvents, newEnvelopes, default);

        var card = await _cardStore.GetByNoteAsync(noteId);
        Assert.Single(card!.ActionItems);
        Assert.Equal(actionId, card.ActionItems[0].ActionId);
    }

    [Fact]
    public async Task Todo_add_is_apply_twice_idempotent()
    {
        var todoId = new TodoId(Guid.NewGuid());
        var added = new TodoAdded(todoId, UserId, "buy milk", null);
        IReadOnlyList<IDomainEvent> newEvents = [added];
        var envelopes = new List<EventEnvelope> { Envelope(todoId.ToStreamId(), added) };

        var updater = NewUpdater();
        await updater.ApplyTodoEventsAsync(newEvents, envelopes, default);
        await updater.ApplyTodoEventsAsync(newEvents, envelopes, default);

        Assert.Single((await _todoStore.QueryAllAsync()).Items);
    }

    [Fact]
    public async Task Folder_create_then_rename_is_apply_twice_idempotent()
    {
        var folderId = new FolderId(Guid.NewGuid());
        var createBatch = new List<EventEnvelope> { Envelope(folderId.ToStreamId(), new FolderCreated(folderId, "Inbox", null)) };
        var renameBatch = new List<EventEnvelope> { Envelope(folderId.ToStreamId(), new FolderRenamed(folderId, "Renamed")) };

        var updater = NewUpdater();
        await updater.ApplyFolderEventsAsync(createBatch, default);
        await updater.ApplyFolderEventsAsync(renameBatch, default);
        await updater.ApplyFolderEventsAsync(createBatch, default);
        await updater.ApplyFolderEventsAsync(renameBatch, default);

        var folders = await _folderStore.GetAllAsync();
        Assert.Single(folders);
        Assert.Equal("Renamed", folders[0].Name);
    }

    [Fact]
    public async Task Workspace_create_then_rename_is_apply_twice_idempotent()
    {
        var workspaceId = new WorkspaceId(WorkspaceId);
        var createBatch = new List<EventEnvelope> { Envelope(workspaceId.ToStreamId(), new WorkspaceCreated(workspaceId, "Work")) };
        var renameBatch = new List<EventEnvelope> { Envelope(workspaceId.ToStreamId(), new WorkspaceRenamed(workspaceId, "Renamed")) };

        var updater = NewUpdater();
        await updater.ApplyWorkspaceEventsAsync(createBatch, default);
        await updater.ApplyWorkspaceEventsAsync(renameBatch, default);
        await updater.ApplyWorkspaceEventsAsync(createBatch, default);
        await updater.ApplyWorkspaceEventsAsync(renameBatch, default);

        var all = await _workspaceStore.GetAllAsync();
        Assert.Single(all);
        Assert.Equal("Renamed", all[0].Name);
    }

    private async Task SeedCardAsync(NoteId noteId)
    {
        var now = DateTimeOffset.UtcNow;
        await _cardStore.UpsertAsync(new NoteCardView(
            noteId, "Title", string.Empty, [], null, now, now, false, [], null, UserId, WorkspaceId));
    }

    private static NoteDetailView NewDetail(NoteId noteId) =>
        new(noteId, "Title", string.Empty, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow,
            UserId: UserId, WorkspaceId: WorkspaceId);

    private static EventEnvelope Envelope(string streamId, IDomainEvent e) =>
        new(streamId, 0, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()),
            new EventMetadata(Guid.NewGuid(), UserId, null, null, WorkspaceId));

    // ContentEdited is persisted under its v1 logical name at version 2 (see NoteCommandHandler.ToEnvelopes).
    private static EventEnvelope ContentEditedEnvelope(NoteId noteId, string content) =>
        new(noteId.ToStreamId(), 0, nameof(ContentEdited), 2, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new ContentEditedV2(noteId, content, content.Length)),
            new EventMetadata(Guid.NewGuid(), UserId, null, null, WorkspaceId));
}
