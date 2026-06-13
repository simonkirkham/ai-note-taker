using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

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

    // BUG-21: an empty/whitespace rename (e.g. the auto-focused title input blurring
    // before the real title loads) must never overwrite a real title with blank.
    [Fact]
    public void ProducesNoEventWhenTitleIsEmpty()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteRenamed(Id, "Interview: Simon Kirkham"))
            .When(new RenameNote(Id, ""))
            .Then();
    }

    [Fact]
    public void ProducesNoEventWhenTitleIsWhitespace()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteRenamed(Id, "Interview: Simon Kirkham"))
            .When(new RenameNote(Id, "   "))
            .Then();
    }
}
