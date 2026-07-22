using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class UnlinkNoteFromCalendarEventSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000099"));
    static readonly DateTimeOffset Start = new(2026, 5, 14, 9, 0, 0, TimeSpan.Zero);
    static readonly DateTimeOffset End = new(2026, 5, 14, 9, 30, 0, TimeSpan.Zero);

    static NoteLinkedToCalendarEvent Linked(string calEventId = "evt_abc123") =>
        new(Id, calEventId, "1:1 with Bill", Start, End, false, null);

    [Fact]
    public void UnlinksNoteFromItsCalendarEvent()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), Linked())
            .When(new UnlinkNoteFromCalendarEvent(Id))
            .Then(new NoteUnlinkedFromCalendarEvent(Id, "evt_abc123"));
    }

    [Fact]
    public void NoOpWhenNoteHasNoLink()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new UnlinkNoteFromCalendarEvent(Id))
            .Then();
    }

    [Fact]
    public void NoOpWhenAlreadyUnlinked()
    {
        Spec
            .Given<Note>(
                new NoteCreated(Id),
                Linked(),
                new NoteUnlinkedFromCalendarEvent(Id, "evt_abc123"))
            .When(new UnlinkNoteFromCalendarEvent(Id))
            .Then();
    }

    [Fact]
    public void RejectsUnlinkWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new UnlinkNoteFromCalendarEvent(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsUnlinkWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), Linked(), new NoteDeleted(Id))
            .When(new UnlinkNoteFromCalendarEvent(Id))
            .ThenThrows<InvalidOperationException>();
    }
}
