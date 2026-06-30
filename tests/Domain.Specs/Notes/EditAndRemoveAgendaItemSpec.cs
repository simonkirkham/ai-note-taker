using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

// Phase 43-C — edit an agenda item's text + remove an item. Same note-stream model as 43-A/B.
// Position is now derived from a MONOTONIC add-counter (not the live item count) so that removing
// an item never makes a later add collide with a surviving item's position (the 43-B forward-flag).
public sealed class EditAndRemoveAgendaItemSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly Guid ItemId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    static readonly Guid ItemId2 = Guid.Parse("00000000-0000-0000-0000-0000000000a2");
    static readonly Guid ItemId3 = Guid.Parse("00000000-0000-0000-0000-0000000000a3");

    [Fact]
    public void EditsItemText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget", 0))
            .When(new EditAgendaItemText(Id, ItemId, "Budget (Q3)"))
            .Then(new AgendaItemTextEdited(Id, ItemId, "Budget (Q3)"));
    }

    [Fact]
    public void TrimsEditedText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget", 0))
            .When(new EditAgendaItemText(Id, ItemId, "  Budget (Q3)  "))
            .Then(new AgendaItemTextEdited(Id, ItemId, "Budget (Q3)"));
    }

    [Fact]
    public void RejectsBlankEditedText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget", 0))
            .When(new EditAgendaItemText(Id, ItemId, "   "))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void RejectsEditOfUnknownItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new EditAgendaItemText(Id, ItemId, "Budget (Q3)"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RemovesAnItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget", 0))
            .When(new RemoveAgendaItem(Id, ItemId))
            .Then(new AgendaItemRemoved(Id, ItemId));
    }

    [Fact]
    public void RejectsRemoveOfUnknownItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RemoveAgendaItem(Id, ItemId))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsEditAndRemoveOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget", 0), new NoteDeleted(Id))
            .When(new RemoveAgendaItem(Id, ItemId))
            .ThenThrows<InvalidOperationException>();
    }

    // The forward-flag from 43-B: after a removal, a new item must NOT reuse a surviving item's
    // position. With a monotonic add-counter, adding after removing item #0 yields position 3
    // (3 adds so far), never 2 (the live count) — so it sorts after the survivors.
    [Fact]
    public void PositionDoesNotCollideAfterRemoval()
    {
        Spec
            .Given<Note>(
                new NoteCreated(Id),
                new AgendaItemAdded(Id, ItemId, "A", 0),
                new AgendaItemAdded(Id, ItemId2, "B", 1),
                new AgendaItemAdded(Id, ItemId3, "C", 2),
                new AgendaItemRemoved(Id, ItemId))
            .When(new AddAgendaItem(Id, Guid.Parse("00000000-0000-0000-0000-0000000000a4"), "D"))
            .Then(new AgendaItemAdded(Id, Guid.Parse("00000000-0000-0000-0000-0000000000a4"), "D", 3));
    }
}
