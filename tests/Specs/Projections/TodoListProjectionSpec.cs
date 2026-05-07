using System.Text.Json;
using Domain;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Specs.Projections;

public sealed class TodoListProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly NoteId NoteId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));
    static readonly ActionId ActionId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000011"));
    static readonly ActionId ActionId2 = new(Guid.Parse("00000000-0000-0000-0000-000000000012"));

    static EventEnvelope NoteEnv(NoteId noteId, long seq, IDomainEvent e) =>
        new(noteId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null));

    static EventEnvelope ActionEnv(ActionId actionId, long seq, IDomainEvent e) =>
        new(actionId.ToStreamId(), seq, e.GetType().Name, 1, DateTimeOffset.UtcNow,
            JsonSerializer.Serialize(e, e.GetType()), new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void ActionItemAdded_AppearsInTodoListWithNoteTitle()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q1 Planning")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));

        var items = projection.GetOpenItems();
        Assert.Single(items);
        Assert.Equal("Book venue", items[0].Description);
        Assert.Equal("Q1 Planning", items[0].NoteTitle);
        Assert.Equal(NoteId1, items[0].NoteId);
    }

    [Fact]
    public void ActionItemCompleted_RemovedFromTodoList()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemCompleted(ActionId1, DateTimeOffset.UtcNow)));

        Assert.Empty(projection.GetOpenItems());
    }

    [Fact]
    public void ActionItemReopened_RestoredToTodoListWithOriginalData()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q1 Planning")));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(ActionEnv(ActionId1, 2, new ActionItemCompleted(ActionId1, DateTimeOffset.UtcNow)));
        projection.Handle(ActionEnv(ActionId1, 3, new ActionItemReopened(ActionId1, DateTimeOffset.UtcNow)));

        var items = projection.GetOpenItems();
        Assert.Single(items);
        Assert.Equal("Book venue", items[0].Description);
        Assert.Equal("Q1 Planning", items[0].NoteTitle);
    }

    [Fact]
    public void NoteRenamed_UpdatesTitleOnExistingOpenItems()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Book venue")));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteRenamed(NoteId1, "Q2 Planning")));

        Assert.Equal("Q2 Planning", projection.GetOpenItems()[0].NoteTitle);
    }

    [Fact]
    public void NoteDeleted_RemovesAllItemsForThatNote()
    {
        var projection = new TodoListProjection();
        projection.Handle(NoteEnv(NoteId1, 1, new NoteCreated(NoteId1)));
        projection.Handle(ActionEnv(ActionId1, 1, new ActionItemAdded(ActionId1, NoteId1, "Task A")));
        projection.Handle(ActionEnv(ActionId2, 1, new ActionItemAdded(ActionId2, NoteId1, "Task B")));
        projection.Handle(NoteEnv(NoteId1, 2, new NoteDeleted(NoteId1)));

        Assert.Empty(projection.GetOpenItems());
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

        var items = projection.GetOpenItems();
        Assert.Equal(2, items.Count);
        Assert.Contains(items, i => i.Description == "Task from A" && i.NoteTitle == "Note A");
        Assert.Contains(items, i => i.Description == "Task from B" && i.NoteTitle == "Note B");
    }
}
