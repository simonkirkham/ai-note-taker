using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordActionItemSuggestionsSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));
    static readonly Guid Action1 = Guid.Parse("11111111-1111-1111-1111-111111111111");
    static readonly Guid Action2 = Guid.Parse("22222222-2222-2222-2222-222222222222");
    const string Model = "amazon.nova-lite-v1:0";
    const string Prompt = "analysis@v1";

    [Fact]
    public void RecordingSuggestionsRaisesActionItemsSuggestedV2StampedWithModelAndPrompt()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordActionItemSuggestions(Id, [Action1, Action2], Model, Prompt))
            .Then(new ActionItemsSuggestedV2(Id, [Action1, Action2], Model, Prompt));
    }

    [Fact]
    public void EmptyListRaisesNothing()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordActionItemSuggestions(Id, [], Model, Prompt))
            .Then();
    }

    [Fact]
    public void RejectsRecordingWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordActionItemSuggestions(Id, [Action1], Model, Prompt))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRecordingOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RecordActionItemSuggestions(Id, [Action1], Model, Prompt))
            .ThenThrows<InvalidOperationException>();
    }
}
