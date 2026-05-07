using Domain.Notes;
using Specs.Harness;

namespace Specs.Notes;

public sealed class SetNoteDateSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000010"));

    [Fact]
    public void SetsDateOnExistingNote()
    {
        var date = new DateOnly(2026, 4, 21);
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new SetNoteDate(Id, date))
            .Then(new NoteDateSet(Id, date));
    }

    [Fact]
    public void ClearsDateWhenNullPassed()
    {
        var date = new DateOnly(2026, 4, 21);
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDateSet(Id, date))
            .When(new SetNoteDate(Id, null))
            .Then(new NoteDateSet(Id, null));
    }

    [Fact]
    public void RejectsSettingDateOnNonExistentNote()
    {
        Spec
            .Given<Note>()
            .When(new SetNoteDate(Id, new DateOnly(2026, 4, 21)))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsSettingDateOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new SetNoteDate(Id, new DateOnly(2026, 4, 21)))
            .ThenThrows<InvalidOperationException>();
    }
}
