using Domain.Folders;
using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class UnfileNoteSpec
{
    static readonly NoteId NoteId = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly FolderId FolderId = new(Guid.Parse("00000000-0000-0000-0000-000000000010"));

    [Fact]
    public void UnfilesNote()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteFiledInFolder(NoteId, FolderId))
            .When(new UnfileNote(NoteId))
            .Then(new NoteUnfiled(NoteId));
    }

    [Fact]
    public void NoOpWhenAlreadyUnfiled()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId))
            .When(new UnfileNote(NoteId))
            .Then();
    }

    [Fact]
    public void RejectsUnfileOnNonExistentNote()
    {
        Spec
            .Given<Note>()
            .When(new UnfileNote(NoteId))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsUnfileOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteDeleted(NoteId))
            .When(new UnfileNote(NoteId))
            .ThenThrows<InvalidOperationException>();
    }
}
