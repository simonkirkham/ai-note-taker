using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

// Phase 43-A — Meeting agenda: add an item.
// Event-model decision (locked here): agenda items are events on the NOTE stream (per-note,
// lightweight, like tags), handled by NoteCommandHandler — NOT a dedicated aggregate. The read
// model is composed onto NoteDetailView (folded by NoteDetailProjection), NOT a separate store:
// agenda is note-scoped, always read with the note, never queried across notes, so a dedicated
// table + backfill would be over-engineering. AgendaItemAdded carries an explicit Position (the
// item's index at add time = capture order) so order is rebuildable from the stream.
public sealed class AddAgendaItemSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly Guid ItemId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");
    static readonly Guid ItemId2 = Guid.Parse("00000000-0000-0000-0000-0000000000a2");

    [Fact]
    public void AddsAnAgendaItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new AddAgendaItem(Id, ItemId, "Budget (Q3)"))
            .Then(new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0));
    }

    [Fact]
    public void AssignsNextPositionByCaptureOrder()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0))
            .When(new AddAgendaItem(Id, ItemId2, "Hiring backfill"))
            .Then(new AgendaItemAdded(Id, ItemId2, "Hiring backfill", 1));
    }

    [Fact]
    public void TrimsItemText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new AddAgendaItem(Id, ItemId, "  Roadmap  "))
            .Then(new AgendaItemAdded(Id, ItemId, "Roadmap", 0));
    }

    [Fact]
    public void RejectsBlankItemText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new AddAgendaItem(Id, ItemId, "   "))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void RejectsWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new AddAgendaItem(Id, ItemId, "Budget (Q3)"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new AddAgendaItem(Id, ItemId, "Budget (Q3)"))
            .ThenThrows<InvalidOperationException>();
    }
}
