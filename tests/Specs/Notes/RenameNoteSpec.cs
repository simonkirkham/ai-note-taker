using Domain.Notes;
using Specs.Harness;

namespace Specs.Notes;

public sealed class RenameNoteSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void RenamesNoteWhenItExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RenameNote(Id, "Stand-up notes"))
            .Then(new NoteRenamed(Id, "Stand-up notes"));
    }

    [Fact]
    public void RejectsRenameWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RenameNote(Id, "Stand-up notes"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void ProducesNoEventWhenTitleIsUnchanged()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteRenamed(Id, "Stand-up notes"))
            .When(new RenameNote(Id, "Stand-up notes"))
            .Then();
    }
}
