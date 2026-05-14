using Domain.Folders;
using Specs.Harness;

namespace Specs.Folders;

public sealed class CreateFolderSpec
{
    static readonly FolderId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000030"));
    static readonly FolderId ParentId = new(Guid.Parse("00000000-0000-0000-0000-000000000031"));
    static readonly DateTimeOffset Now = new(2026, 5, 14, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void CreatesRootFolder()
    {
        Spec
            .Given<Folder>()
            .When(new CreateFolder(Id, "People", null, Now))
            .Then(new FolderCreated(Id, "People", null));
    }

    [Fact]
    public void CreatesSubfolder()
    {
        Spec
            .Given<Folder>()
            .When(new CreateFolder(Id, "Bill", ParentId, Now))
            .Then(new FolderCreated(Id, "Bill", ParentId));
    }

    [Fact]
    public void RejectsEmptyName()
    {
        Spec
            .Given<Folder>()
            .When(new CreateFolder(Id, "", null, Now))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhitespaceName()
    {
        Spec
            .Given<Folder>()
            .When(new CreateFolder(Id, "   ", null, Now))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDuplicateCreate()
    {
        Spec
            .Given<Folder>(new FolderCreated(Id, "People", null))
            .When(new CreateFolder(Id, "People", null, Now))
            .ThenThrows<InvalidOperationException>();
    }
}
