using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class CompleteTranscriptionSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    // Scenario: Transcript is persisted when recording stops
    //   Given a Note exists
    //   When CompleteTranscription is handled with "Action items: fix the login bug"
    //   Then TranscriptionCompleted is raised
    //   And the note's TranscriptText is "Action items: fix the login bug"
    [Fact]
    public void RaisesTranscriptionCompleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new CompleteTranscription(Id, "Action items: fix the login bug", 42))
            .Then(new TranscriptionCompleted(Id, "Action items: fix the login bug", 42));
    }

    // Scenario: Re-recording overwrites the previous transcript
    //   Given a Note has an existing TranscriptionCompleted event
    //   When CompleteTranscription is handled again with new text
    //   Then TranscriptionCompleted is raised with the new text
    [Fact]
    public void OverwritesPreviousTranscript()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new TranscriptionCompleted(Id, "old transcript", 10))
            .When(new CompleteTranscription(Id, "new transcript", 20))
            .Then(new TranscriptionCompleted(Id, "new transcript", 20));
    }

    [Fact]
    public void RejectsWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new CompleteTranscription(Id, "some text", 10))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new CompleteTranscription(Id, "some text", 10))
            .ThenThrows<InvalidOperationException>();
    }
}
