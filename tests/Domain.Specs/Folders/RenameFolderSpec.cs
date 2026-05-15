using Domain.Folders;
using Domain.Specs.Harness;

namespace Domain.Specs.Folders;

public sealed class RenameFolderSpec
{
    static readonly FolderId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000030"));

    [Fact]
    public void RenamesFolder()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "Peopl", null))
            .When(new RenameFolder(Id, "People"))
            .Then(new FolderRenamed(Id, "People"));
    }

    [Fact]
    public void NoOpWhenNameUnchanged()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null))
            .When(new RenameFolder(Id, "People"))
            .Then();
    }

    [Fact]
    public void RejectsEmptyName()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null))
            .When(new RenameFolder(Id, ""))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhitespaceName()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null))
            .When(new RenameFolder(Id, "   "))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRenameOnNonExistentFolder()
    {
        Spec
            .Given<Folder>()
            .When(new RenameFolder(Id, "People"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRenameOnDeletedFolder()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null), new FolderDeleted(Id))
            .When(new RenameFolder(Id, "People2"))
            .ThenThrows<InvalidOperationException>();
    }
}
