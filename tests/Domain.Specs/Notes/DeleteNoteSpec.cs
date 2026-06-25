using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class DeleteNoteSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000003"));

    [Fact]
    public void DeletesNoteWhenNoteExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new DeleteNote(Id))
            .Then(new NoteDeleted(Id));
    }

    [Fact]
    public void RejectsDeleteWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new DeleteNote(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDeleteWhenNoteAlreadyDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new DeleteNote(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRenameWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RenameNote(Id, "New Title"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsEditContentWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new EditContent(Id, "Some content"))
            .ThenThrows<InvalidOperationException>();
    }
}
