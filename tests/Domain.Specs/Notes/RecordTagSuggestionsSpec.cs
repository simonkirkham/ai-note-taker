using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordTagSuggestionsSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    const string Model = "amazon.nova-lite-v1:0";
    const string Prompt = "analysis@v1";

    [Fact]
    public void RecordingSuggestionsRaisesTagsSuggestedV2StampedWithModelAndPrompt()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordTagSuggestions(Id, ["auth", "backend"], Model, Prompt))
            .Then(new TagsSuggestedV2(Id, ["auth", "backend"], Model, Prompt));
    }

    [Fact]
    public void EmptySuggestionListRaisesNothing()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordTagSuggestions(Id, [], Model, Prompt))
            .Then();
    }

    [Fact]
    public void RejectsRecordingWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordTagSuggestions(Id, ["auth"], Model, Prompt))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRecordingOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RecordTagSuggestions(Id, ["auth"], Model, Prompt))
            .ThenThrows<InvalidOperationException>();
    }
}
