using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordDiarizedTranscriptionSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    // Scenario: the diarized transcript is recorded when the batch job completes
    [Fact]
    public void RaisesTranscriptionDiarized()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordDiarizedTranscription(Id, "Speaker 1: hello\nSpeaker 2: hi", 2, "job-1", "recordings/x/take.wav"))
            .Then(new TranscriptionDiarized(Id, "Speaker 1: hello\nSpeaker 2: hi", 2, "job-1", "recordings/x/take.wav"));
    }

    // Scenario: the diarized transcript supersedes the streamed one (latest wins)
    [Fact]
    public void DiarizedSupersedesStreamedTranscript()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new TranscriptionCompleted(Id, "streamed words", 30))
            .When(new RecordDiarizedTranscription(Id, "Speaker 1: streamed words", 1, "job-2", "recordings/x/take.wav"))
            .Then(new TranscriptionDiarized(Id, "Speaker 1: streamed words", 1, "job-2", "recordings/x/take.wav"));
    }

    // Scenario: a failed/empty diarization never blanks the note
    [Fact]
    public void RejectsBlankDiarizedText()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordDiarizedTranscription(Id, "   ", 0, "job-3", "recordings/x/take.wav"))
            .ThenThrows<ArgumentException>();
    }

    [Fact]
    public void RejectsWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordDiarizedTranscription(Id, "Speaker 1: hi", 1, "job-4", "recordings/x/take.wav"))
            .ThenThrows<InvalidOperationException>();
    }
}
