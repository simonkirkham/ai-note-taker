using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class EventVersioningSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000002"));

    [Fact]
    public void No_op_is_detected_when_v2_ContentEdited_is_in_history()
    {
        // Fails before implementation: Note.Apply does not handle ContentEditedV2,
        // so _content stays null, the equality check fails, and ContentEdited is emitted.
        Spec
            .Given<Note>(new NoteCreated(Id), new ContentEditedV2(Id, "same content", 12))
            .When(new EditContent(Id, "same content"))
            .Then();
    }
}
