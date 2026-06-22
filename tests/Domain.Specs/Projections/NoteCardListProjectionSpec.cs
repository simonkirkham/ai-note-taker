using System.Text.Json;
using Domain.ActionItems;
using Domain.Notes;
using EventStore;
using EventStore.Projections;

namespace Domain.Specs.Projections;

public sealed class NoteCardListProjectionSpec
{
    static readonly NoteId NoteId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly ActionId ActionId1 = new(Guid.Parse("00000000-0000-0000-0000-000000000010"));

    static EventEnvelope NoteEnv(long seq, string type, string payload, DateTimeOffset? at = null, int version = 1) =>
        new($"note#{NoteId1.Value}", seq, type, version, at ?? DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    static EventEnvelope ActionEnv(ActionId actionId, long seq, string type, string payload) =>
        new(actionId.ToStreamId(), seq, type, 1, DateTimeOffset.UtcNow, payload,
            new EventMetadata(Guid.NewGuid(), null, null, null));

    [Fact]
    public void NoteCreated_adds_card_with_empty_title_and_content()
    {
        var projection = new NoteCardListProjection();

        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        var cards = projection.GetAll();
        Assert.Single(cards);
        Assert.Equal(NoteId1, cards[0].NoteId);
        Assert.Equal(string.Empty, cards[0].Title);
        Assert.Equal(string.Empty, cards[0].Content);
        Assert.False(cards[0].Deleted);
    }

    [Fact]
    public void NoteCreated_without_assignment_leaves_workspace_null()
    {
        // Historical notes (created before 23-B) carry no NoteAssignedToWorkspace;
        // the row's WorkspaceId stays null and read paths resolve it to the default.
        var projection = new NoteCardListProjection();

        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        Assert.Null(projection.GetAll()[0].WorkspaceId);
    }

    [Fact]
    public void NoteAssignedToWorkspace_sets_card_workspace()
    {
        var projection = new NoteCardListProjection();
        var ws = new Domain.Workspaces.WorkspaceId("ws-work");

        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(NoteEnv(2, nameof(NoteAssignedToWorkspace),
            JsonSerializer.Serialize(new NoteAssignedToWorkspace(NoteId1, ws))));

        Assert.Equal("ws-work", projection.GetAll()[0].WorkspaceId);
    }

    [Fact]
    public void NoteRenamed_updates_title()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        projection.Handle(NoteEnv(2, nameof(NoteRenamed),
            JsonSerializer.Serialize(new NoteRenamed(NoteId1, "Bill 1:1"))));

        Assert.Equal("Bill 1:1", projection.GetAll()[0].Title);
    }

    [Fact]
    public void ContentEditedV2_updates_content()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        projection.Handle(NoteEnv(2, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEditedV2(NoteId1, "Meeting notes", 13)), version: 2));

        Assert.Equal("Meeting notes", projection.GetAll()[0].Content);
    }

    [Fact]
    public void ContentEditedV2_truncates_content_at_200_chars()
    {
        var longContent = new string('x', 250);
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        projection.Handle(NoteEnv(2, nameof(ContentEdited),
            JsonSerializer.Serialize(new ContentEditedV2(NoteId1, longContent, 250)), version: 2));

        Assert.Equal(200, projection.GetAll()[0].Content.Length);
    }

    [Fact]
    public void NoteDateSet_updates_date()
    {
        var date = new DateOnly(2026, 4, 21);
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        projection.Handle(NoteEnv(2, nameof(NoteDateSet),
            JsonSerializer.Serialize(new NoteDateSet(NoteId1, date))));

        Assert.Equal(date, projection.GetAll()[0].Date);
    }

    [Fact]
    public void NoteDeleted_marks_card_deleted()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));

        projection.Handle(NoteEnv(2, nameof(NoteDeleted),
            JsonSerializer.Serialize(new NoteDeleted(NoteId1))));

        Assert.True(projection.GetAll()[0].Deleted);
    }

    [Fact]
    public void ActionItemAdded_appends_action_item_as_open()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(ActionEnv(ActionId1, 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId1, NoteId1, "Send agenda"))));

        var action = Assert.Single(projection.GetAll()[0].ActionItems);
        Assert.Equal(ActionId1, action.ActionId);
        Assert.Equal("Send agenda", action.Description);
        Assert.False(action.Completed);
    }

    [Fact]
    public void ActionItemCompleted_marks_action_completed()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(ActionEnv(ActionId1, 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId1, NoteId1, "Send agenda"))));

        projection.Handle(ActionEnv(ActionId1, 2, nameof(ActionItemCompleted),
            JsonSerializer.Serialize(new ActionItemCompleted(ActionId1, DateTimeOffset.UtcNow))));

        Assert.True(projection.GetAll()[0].ActionItems[0].Completed);
    }

    [Fact]
    public void ActionItemReopened_marks_action_open()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(ActionEnv(ActionId1, 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId1, NoteId1, "Send agenda"))));
        projection.Handle(ActionEnv(ActionId1, 2, nameof(ActionItemCompleted),
            JsonSerializer.Serialize(new ActionItemCompleted(ActionId1, DateTimeOffset.UtcNow))));

        projection.Handle(ActionEnv(ActionId1, 3, nameof(ActionItemReopened),
            JsonSerializer.Serialize(new ActionItemReopened(ActionId1, DateTimeOffset.UtcNow))));

        Assert.False(projection.GetAll()[0].ActionItems[0].Completed);
    }

    [Fact]
    public void ActionItemDeleted_removes_action_item()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(ActionEnv(ActionId1, 1, nameof(ActionItemAdded),
            JsonSerializer.Serialize(new ActionItemAdded(ActionId1, NoteId1, "Old task"))));

        projection.Handle(ActionEnv(ActionId1, 2, nameof(ActionItemDeleted),
            JsonSerializer.Serialize(new ActionItemDeleted(ActionId1, DateTimeOffset.UtcNow))));

        Assert.Empty(projection.GetAll()[0].ActionItems);
    }

    [Fact]
    public void NoteTagged_lowercases_and_dedupes_card_tags()
    {
        // Legacy data: a card tagged "Foo" then "foo" (two distinct events under the old
        // case-sensitive aggregate). After the lowercase fold the card carries one "foo".
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(NoteEnv(2, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "Foo"))));
        projection.Handle(NoteEnv(3, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "foo"))));

        Assert.Equal(new[] { "foo" }, projection.GetAll()[0].Tags);
    }

    [Fact]
    public void NoteUntagged_removes_card_tag_case_insensitively()
    {
        var projection = new NoteCardListProjection();
        projection.Handle(NoteEnv(1, nameof(NoteCreated),
            JsonSerializer.Serialize(new NoteCreated(NoteId1))));
        projection.Handle(NoteEnv(2, nameof(NoteTagged),
            JsonSerializer.Serialize(new NoteTagged(NoteId1, "Foo"))));
        projection.Handle(NoteEnv(3, nameof(NoteUntagged),
            JsonSerializer.Serialize(new NoteUntagged(NoteId1, "FOO"))));

        Assert.Empty(projection.GetAll()[0].Tags ?? []);
    }

    [Fact]
    public void GetAll_orders_by_createdAt_descending()
    {
        var noteId2 = new NoteId(Guid.Parse("00000000-0000-0000-0000-000000000002"));
        var older = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        var newer = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
        var projection = new NoteCardListProjection();

        projection.Handle(new EventEnvelope($"note#{NoteId1.Value}", 1, nameof(NoteCreated), 1, older,
            JsonSerializer.Serialize(new NoteCreated(NoteId1)), new EventMetadata(Guid.NewGuid(), null, null, null)));
        projection.Handle(new EventEnvelope($"note#{noteId2.Value}", 1, nameof(NoteCreated), 1, newer,
            JsonSerializer.Serialize(new NoteCreated(noteId2)), new EventMetadata(Guid.NewGuid(), null, null, null)));

        var cards = projection.GetAll();
        Assert.Equal(noteId2, cards[0].NoteId);
        Assert.Equal(NoteId1, cards[1].NoteId);
    }
}

