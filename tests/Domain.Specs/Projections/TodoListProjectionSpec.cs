using System.Text.Json;
using Domain.ActionItems;
using Domain.Notes;
using Domain.Todos;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class TodoListProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly ActionId ActionId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000011"));
    static readonly ActionId ActionId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000012"));
    static readonly TodoId TodoId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000021"));

    static EventEnvelope NoteEnv(NoteId noteId, long seq, IDomainEvent e) =>
        new(noteId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null));

    static EventEnvelope ActionEnv(ActionId actionId, long seq, IDomainEvent e) =>
        new(actionId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null));

    static EventEnvelope TodoEnv(TodoId todoId, long seq, IDomainEvent e) =>
        new(todoId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void ActionItemAdded_AppearsAsOpenItemWithNoteTitle()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q1 Planning")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Book venue", items[0].Description);
        Assert.Equal("Q1 Planning", items[0].NoteTitle);
        Assert.Equal(NoteId1.Value.ToString(), items[0].NoteId);
        Assert.Equal("action", items[0].Type);
        Assert.Null(items[0].CompletedAt);
    }

    [Fact]
    public void ActionItemCompleted_RetainedWithCompletedAt()
    {
        var completedAt = new DateTimeOffset(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemCompleted(ActionId1, completedAt)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal(completedAt, items[0].CompletedAt);
    }

    [Fact]
    public void ActionItemReopened_ClearsCompletedAt()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q1 Planning")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemCompleted(ActionId1, DateTimeOffset.UtcNow)));
        projection.Handle(ActionEnv(ActionId1, 3, new ActionItemReopened(ActionId1, DateTimeOffset.UtcNow)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Book venue", items[0].Description);
        Assert.Null(items[0].CompletedAt);
    }

    [Fact]
    public void ActionItemEdited_UpdatesDescriptionOnActionRow()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemEdited(ActionId1, "Book the venue", DateTimeOffset.UtcNow)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Book the venue", items[0].Description);
        Assert.Equal("action", items[0].Type);
    }

    [Fact]
    public void NoteRenamed_UpdatesTitleOnExistingItems()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q2 Planning")));

        Assert.Equal("Q2 Planning", projection.GetAllItems()[0].NoteTitle);
    }

    [Fact]
    public void NoteDeleted_RemovesAllItemsForThatNote()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Task A")));
        projection.Handle(ActionEnv(ActionId2, 1, new ActionItemAdded(ActionId2, NoteId1, "Task B")));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteDeleted(NoteId1)));

        Assert.Empty(projection.GetAllItems());
    }

    [Fact]
    public void ActionItemDeleted_RemovedFromProjection()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Old task")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemDeleted(ActionId1, DateTimeOffset.UtcNow)));

        Assert.Empty(projection.GetAllItems());
    }

    [Fact]
    public void TodoList_AggregatesItemsFromMultipleNotes()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Note A")));
        projection.Handle(NoteEnv(NoteId2, 1, new NoteCreated(NoteId2)));
        projection.Handle(NoteEnv(NoteId2, 2, new NoteRenamed(NoteId2, "Note B")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Task from A")));
        projection.Handle(ActionEnv(ActionId2, 1, new ActionItemAdded(ActionId2, NoteId2, "Task from B")));

        var items = projection.GetAllItems();
        Assert.Equal(2, items.Count);
        Assert.Contains(items, i => i.Description == "Task from A" && i.NoteTitle == "Note A");
        Assert.Contains(items, i => i.Description == "Task from B" && i.NoteTitle == "Note B");
    }

    [Fact]
    public void TodoAdded_AppearsAsOpenItemWithNoNoteInfo()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Buy milk", items[0].Description);
        Assert.Equal("todo", items[0].Type);
        Assert.Null(items[0].NoteId);
        Assert.Null(items[0].NoteTitle);
        Assert.Null(items[0].CompletedAt);
    }

    [Fact]
    public void TodoEdited_UpdatesDescription()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));
        projection.Handle(TodoEnv(TodoId1, 2, new TodoEdited(TodoId1, "Buy oat milk", DateTimeOffset.UtcNow)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Buy oat milk", items[0].Description);
        Assert.Equal("todo", items[0].Type);
    }

    [Fact]
    public void TodoEdited_PreservesCompletedState()
    {
        var completedAt = new DateTimeOffset(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));
        projection.Handle(TodoEnv(TodoId1, 2, new TodoCompleted(TodoId1, completedAt)));
        projection.Handle(TodoEnv(TodoId1, 3, new TodoEdited(TodoId1, "Buy oat milk", DateTimeOffset.UtcNow)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal("Buy oat milk", items[0].Description);
        Assert.Equal(completedAt, items[0].CompletedAt);
    }

    [Fact]
    public void TodoCompleted_RetainedWithCompletedAt()
    {
        var completedAt = new DateTimeOffset(2024, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));
        projection.Handle(TodoEnv(TodoId1, 2, new TodoCompleted(TodoId1, completedAt)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Equal(completedAt, items[0].CompletedAt);
    }

    [Fact]
    public void TodoReopened_ClearsCompletedAt()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));
        projection.Handle(TodoEnv(TodoId1, 2, new TodoCompleted(TodoId1, DateTimeOffset.UtcNow)));
        projection.Handle(TodoEnv(TodoId1, 3, new TodoReopened(TodoId1, DateTimeOffset.UtcNow)));

        var items = projection.GetAllItems();
        Assert.Single(items);
        Assert.Null(items[0].CompletedAt);
    }

    [Fact]
    public void TodoDeleted_RemovedFromProjection()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));
        projection.Handle(TodoEnv(TodoId1, 2, new TodoDeleted(TodoId1, DateTimeOffset.UtcNow)));

        Assert.Empty(projection.GetAllItems());
    }

    [Fact]
    public void ActionItemsAndStandaloneTodos_CoexistInProjection()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Work Notes")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Review slides")));
        projection.Handle(TodoEnv(TodoId1, 1, new TodoAdded(TodoId1, "user-1", "Buy milk", null)));

        var items = projection.GetAllItems();
        Assert.Equal(2, items.Count);
        Assert.Contains(items, i => i.Type == "action" && i.NoteTitle == "Work Notes");
        Assert.Contains(items, i => i.Type == "todo" && i.NoteId == null);
    }

    static EventEnvelope TodoEnvWs(TodoId todoId, long seq, IDomainEvent e, string workspaceId) =>
        new(todoId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null, workspaceId));

    [Fact]
    public void ActionItem_InheritsParentNoteWorkspace()
    {
        var ws = new Domain.Workspaces.WorkspaceId("ws-work");
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteAssignedToWorkspace(NoteId1, ws)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));

        Assert.Equal("ws-work", projection.GetAllItems()[0].WorkspaceId);
    }

    [Fact]
    public void StandaloneTodo_TakesTheWriteMetadataWorkspace()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnvWs(TodoId1, 1, new TodoAdded(TodoId1, "u1", "buy milk", null), "ws-home"));

        Assert.Equal("ws-home", projection.GetAllItems()[0].WorkspaceId);
    }

    static readonly TodoId TodoA = new(Guid.Parse("00000000-0000-0000-0000-0000000000a1"));
    static readonly TodoId TodoB = new(Guid.Parse("00000000-0000-0000-0000-0000000000b2"));
    static readonly TodoId TodoC = new(Guid.Parse("00000000-0000-0000-0000-0000000000c3"));

    static EventEnvelope TodoEnvAt(TodoId id, IDomainEvent e, DateTimeOffset at) =>
        new(id.ToStreamId(), 1, e.GetType().Name, 1, at,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null, "ws-1"));

    static EventEnvelope OrderEnv(string ws, params string[] ids) =>
        new($"todo-order#{ws}", 1, nameof(TodoListReordered), 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(new TodoListReordered(ws, ids, DateTimeOffset.UtcNow)),
            new EventMetadata(Guid.NewGuid(), null, null, null, ws));

    static DateTimeOffset T(int min) => new(2026, 6, 25, 9, min, 0, TimeSpan.Zero);

    [Fact]
    public void Reorder_SnapshotSetsExplicitOrder()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnvAt(TodoA, new TodoAdded(TodoA, "u", "A", null), T(1)));
        projection.Handle(TodoEnvAt(TodoB, new TodoAdded(TodoB, "u", "B", null), T(2)));
        projection.Handle(TodoEnvAt(TodoC, new TodoAdded(TodoC, "u", "C", null), T(3)));

        projection.Handle(OrderEnv("ws-1", TodoC.Value.ToString(), TodoA.Value.ToString(), TodoB.Value.ToString()));

        Assert.Equal(new[] { "C", "A", "B" }, projection.GetAllItems().Select(i => i.Description));
    }

    [Fact]
    public void Reorder_UnpositionedItemAppendsByAddedAt()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnvAt(TodoA, new TodoAdded(TodoA, "u", "A", null), T(1)));
        projection.Handle(TodoEnvAt(TodoB, new TodoAdded(TodoB, "u", "B", null), T(2)));
        projection.Handle(TodoEnvAt(TodoC, new TodoAdded(TodoC, "u", "C", null), T(3)));
        // Only C and A are positioned; B stays unpositioned and sorts after, by AddedAt.
        projection.Handle(OrderEnv("ws-1", TodoC.Value.ToString(), TodoA.Value.ToString()));

        Assert.Equal(new[] { "C", "A", "B" }, projection.GetAllItems().Select(i => i.Description));
    }

    [Fact]
    public void Reorder_OnlyAffectsItemsInTheSnapshot()
    {
        var projection = new TodoListProjection();
        projection.Handle(TodoEnvAt(TodoA, new TodoAdded(TodoA, "u", "A", null), T(1)));
        projection.Handle(TodoEnvAt(TodoB, new TodoAdded(TodoB, "u", "B", null), T(2)));
        projection.Handle(TodoEnvAt(TodoC, new TodoAdded(TodoC, "u", "C", null), T(3)));

        projection.Handle(OrderEnv("ws-1", TodoB.Value.ToString(), TodoA.Value.ToString()));

        var byId = projection.GetAllItems().ToDictionary(i => i.Description, i => i.Position);
        Assert.Equal(0, byId["B"]);
        Assert.Equal(1, byId["A"]);
        Assert.Null(byId["C"]);
    }
}
