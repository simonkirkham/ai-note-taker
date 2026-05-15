using Domain.Folders;
using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class MoveNoteToFolderSpec
{
    static readonly NoteId   NoteId   = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly FolderId FolderId = new(Guid.Parse("00000000-0000-0000-0000-000000000010"));

    [Fact]
    public void FilesNoteInFolder()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId))
            .When(new MoveNoteToFolder(NoteId, FolderId))
            .Then(new NoteFiledInFolder(NoteId, FolderId));
    }

    [Fact]
    public void RejectsMoveOnNonExistentNote()
    {
        Spec
            .Given<Note>()
            .When(new MoveNoteToFolder(NoteId, FolderId))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsMoveOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteDeleted(NoteId))
            .When(new MoveNoteToFolder(NoteId, FolderId))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void CanMoveNoteToAnotherFolder()
    {
        var otherFolderId = new FolderId(Guid.Parse("00000000-0000-0000-0000-000000000011"));
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteFiledInFolder(NoteId, FolderId))
            .When(new MoveNoteToFolder(NoteId, otherFolderId))
            .Then(new NoteFiledInFolder(NoteId, otherFolderId));
    }

    [Fact]
    public void NoOpWhenAlreadyInSameFolder()
    {
        Spec
            .Given<Note>(new NoteCreated(NoteId), new NoteFiledInFolder(NoteId, FolderId))
            .When(new MoveNoteToFolder(NoteId, FolderId))
            .Then();
    }
}
