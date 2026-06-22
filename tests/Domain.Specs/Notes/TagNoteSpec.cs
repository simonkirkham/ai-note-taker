using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

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
            .When(new TagNote(Id, "bill"))
            .Then(new NoteTagged(Id, "bill"));
    }

    [Fact]
    public void LowercasesTag()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new TagNote(Id, "Foo Bar"))
            .Then(new NoteTagged(Id, "foo bar"));
    }

    [Fact]
    public void TrimsAndLowercasesTag()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new TagNote(Id, "  Work "))
            .Then(new NoteTagged(Id, "work"));
    }

    [Fact]
    public void RejectsCaseVariantDuplicate()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "work"))
            .When(new TagNote(Id, "WORK"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsDuplicateAgainstLegacyMixedCaseHistory()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "Foo"))
            .When(new TagNote(Id, "foo"))
            .ThenThrows<InvalidOperationException>();
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
    public void UntagIsCaseInsensitiveAgainstLegacyHistory()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteTagged(Id, "Foo"))
            .When(new UntagNote(Id, "FOO"))
            .Then(new NoteUntagged(Id, "foo"));
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
