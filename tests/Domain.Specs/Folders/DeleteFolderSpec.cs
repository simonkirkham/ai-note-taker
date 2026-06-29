using Domain.Folders;
using Domain.Specs.Harness;

namespace Domain.Specs.Folders;

public sealed class DeleteFolderSpec
{
    static readonly FolderId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000030"));

    [Fact]
    public void DeletesFolder()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null))
            .When(new DeleteFolder(Id))
            .Then(new FolderDeleted(Id));
    }

    [Fact]
    public void RejectsDeleteOnNonExistentFolder()
    {
        Spec
            .Given<Folder>()
            .When(new DeleteFolder(Id))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDeleteOnAlreadyDeletedFolder()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null), new FolderDeleted(Id))
            .When(new DeleteFolder(Id))
            .ThenThrows<InvalidOperationException>();
    }
}
