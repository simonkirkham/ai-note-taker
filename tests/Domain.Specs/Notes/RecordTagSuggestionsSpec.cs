using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordTagSuggestionsSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void RecordingSuggestionsRaisesTagsSuggested()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordTagSuggestions(Id, ["auth", "backend"]))
            .Then(new TagsSuggested(Id, ["auth", "backend"]));
    }

    [Fact]
    public void EmptySuggestionListRaisesNothing()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordTagSuggestions(Id, []))
            .Then();
    }

    [Fact]
    public void RejectsRecordingWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordTagSuggestions(Id, ["auth"]))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRecordingOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RecordTagSuggestions(Id, ["auth"]))
            .ThenThrows<InvalidOperationException>();
    }
}
