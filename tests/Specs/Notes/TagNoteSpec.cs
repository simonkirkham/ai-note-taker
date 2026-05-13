using Domain.Notes;
using Specs.Harness;

namespace Specs.Notes;

public sealed class TagNoteSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void TagsANote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new TagNote(Id, "1:1s"))
            .Then(new NoteTagged(Id, "1:1s"));
    }

    [Fact]
    public void RejectsTagWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new TagNote(Id, "1:1s"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDuplicateTag()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "1:1s"))
            .When(new TagNote(Id, "1:1s"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsTagOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new TagNote(Id, "1:1s"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void AllowsSecondDistinctTag()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "1:1s"))
            .When(new TagNote(Id, "Bill"))
            .Then(new NoteTagged(Id, "Bill"));
    }

    [Fact]
    public void UntagsANote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "1:1s"))
            .When(new UntagNote(Id, "1:1s"))
            .Then(new NoteUntagged(Id, "1:1s"));
    }

    [Fact]
    public void RejectsUntagWhenTagNotPresent()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new UntagNote(Id, "1:1s"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsUntagWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new UntagNote(Id, "1:1s"))
            .ThenThrows<InvalidOperationException>();
    }
}
