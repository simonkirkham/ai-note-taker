using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class SaveRecordingSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    // Scenario: The call recording is saved when the upload finishes
    //   Given a Note exists
    //   When SaveRecording is handled with an S3 key
    //   Then RecordingUploaded is raised with that key
    [Fact]
    public void RaisesRecordingUploaded()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new SaveRecording(Id, "recordings/abc/take.wav"))
            .Then(new RecordingUploaded(Id, "recordings/abc/take.wav"));
    }

    // Scenario: Re-recording overwrites the previous recording (latest wins)
    [Fact]
    public void OverwritesPreviousRecording()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new RecordingUploaded(Id, "recordings/abc/old.wav"))
            .When(new SaveRecording(Id, "recordings/abc/new.wav"))
            .Then(new RecordingUploaded(Id, "recordings/abc/new.wav"));
    }

    [Fact]
    public void RejectsWhenAudioKeyIsBlank()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new SaveRecording(Id, "   "))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void RejectsWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new SaveRecording(Id, "recordings/abc/take.wav"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsWhenNoteIsDeleted()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new SaveRecording(Id, "recordings/abc/take.wav"))
            .ThenThrows<InvalidOperationException>();
    }
}
