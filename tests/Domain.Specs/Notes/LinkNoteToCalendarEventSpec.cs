using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class LinkNoteToCalendarEventSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000099"));
    static readonly DateTimeOffset Start = new(2026, 5, 14, 9, 0, 0, TimeSpan.Zero);
    static readonly DateTimeOffset End = new(2026, 5, 14, 9, 30, 0, TimeSpan.Zero);

    static LinkNoteToCalendarEvent LinkCmd(string calEventId = "evt_abc123") =>
        new(Id, calEventId, "1:1 with Bill", Start, End, false, null);

    [Fact]
    public void LinksNoteToCalendarEvent()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(LinkCmd())
            .Then(new NoteLinkedToCalendarEvent(Id, "evt_abc123", "1:1 with Bill", Start, End, false, null));
    }

    [Fact]
    public void RejectsLinkWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(LinkCmd())
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsLinkWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(LinkCmd())
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsLinkWhenNoteAlreadyLinked()
    {
        Spec
            .Given<Note>(
                new NoteCreated(Id),
                new NoteLinkedToCalendarEvent(Id, "other_event", "Other Meeting", Start, End, false, null))
            .When(LinkCmd("evt_abc123"))
            .ThenThrows<InvalidOperationException>();
    }
}
