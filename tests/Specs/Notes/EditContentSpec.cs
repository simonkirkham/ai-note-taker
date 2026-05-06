using Domain.Notes;
using Specs.Harness;

namespace Specs.Notes;

public sealed class EditContentSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact(Skip = "Pip 2-B")]
    public void EditsContentWhenNoteExists()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new EditContent(Id, "Today we discussed the roadmap."))
            .Then(new ContentEdited(Id, "Today we discussed the roadmap."));
    }

    [Fact(Skip = "Pip 2-B")]
    public void RejectsEditWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new EditContent(Id, "Some content"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact(Skip = "Pip 2-B")]
    public void ProducesNoEventWhenContentIsUnchanged()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEdited(Id, "Some content"))
            .When(new EditContent(Id, "Some content"))
            .Then();
    }
}
