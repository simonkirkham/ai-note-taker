using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

// Phase 43-B — tick / untick an agenda item (2-state: open or ticked). Same note-stream model as
// 43-A; AgendaItemDiscussedSet carries the new boolean state (idempotent — setting the current
// state emits nothing). The aggregate tracks each item's id + discussed state to validate the
// item exists and to no-op a redundant set.
public sealed class SetAgendaItemDiscussedSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly Guid ItemId = Guid.Parse("00000000-0000-0000-0000-0000000000a1");

    [Fact]
    public void TicksAnItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0))
            .When(new SetAgendaItemDiscussed(Id, ItemId, true))
            .Then(new AgendaItemDiscussedSet(Id, ItemId, true));
    }

    [Fact]
    public void UnticksAnItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0),
                new AgendaItemDiscussedSet(Id, ItemId, true))
            .When(new SetAgendaItemDiscussed(Id, ItemId, false))
            .Then(new AgendaItemDiscussedSet(Id, ItemId, false));
    }

    [Fact]
    public void TickingAnAlreadyTickedItemIsANoOp()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0),
                new AgendaItemDiscussedSet(Id, ItemId, true))
            .When(new SetAgendaItemDiscussed(Id, ItemId, true))
            .Then();
    }

    [Fact]
    public void UntickingAnOpenItemIsANoOp()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0))
            .When(new SetAgendaItemDiscussed(Id, ItemId, false))
            .Then();
    }

    [Fact]
    public void RejectsUnknownItem()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new SetAgendaItemDiscussed(Id, ItemId, true))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new SetAgendaItemDiscussed(Id, ItemId, true))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new AgendaItemAdded(Id, ItemId, "Budget (Q3)", 0),
                new NoteDeleted(Id))
            .When(new SetAgendaItemDiscussed(Id, ItemId, true))
            .ThenThrows<InvalidOperationException>();
    }
}
