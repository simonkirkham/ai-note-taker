using Domain.Notes;
using Specs.Harness;

namespace Specs.Notes;

public sealed class CreateNoteSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void CreatesNoteWhenItDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new CreateNote(Id))
            .Then(new NoteCreated(Id));
    }

    [Fact]
    public void RejectsCreateWhenNoteAlreadyExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new CreateNote(Id))
            .ThenThrows<InvalidOperationException>();
    }
}
