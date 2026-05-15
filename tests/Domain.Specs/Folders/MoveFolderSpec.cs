using Domain.Folders;
using Domain.Specs.Harness;

namespace Domain.Specs.Folders;

public sealed class MoveFolderSpec
{
    static readonly FolderId Id       = new(Guid.Parse("00000000-0000-0000-0000-000000000030"));
    static readonly FolderId ParentId = new(Guid.Parse("00000000-0000-0000-0000-000000000031"));

    [Fact]
    public void MovesToParent()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "Bill", null))
            .When(new MoveFolder(Id, ParentId))
            .Then(new FolderMoved(Id, ParentId));
    }

    [Fact]
    public void MovesToRoot()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "Bill", ParentId))
            .When(new MoveFolder(Id, null))
            .Then(new FolderMoved(Id, null));
    }

    [Fact]
    public void RejectsMoveOnNonExistentFolder()
    {
        Spec
            .Given<Folder>()
            .When(new MoveFolder(Id, ParentId))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsMoveOnDeletedFolder()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "Bill", null), new FolderDeleted(Id))
            .When(new MoveFolder(Id, ParentId))
            .ThenThrows<InvalidOperationException>();
    }
}
