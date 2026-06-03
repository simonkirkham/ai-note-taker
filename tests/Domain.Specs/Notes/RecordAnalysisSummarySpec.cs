using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordAnalysisSummarySpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void RecordingSummaryRaisesAnalysisSummaryRecorded()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordAnalysisSummary(Id,
                "We discussed the login bug.",
                ["Login fails on Friday", "Owner is Alice"],
                ["Ship the fix by Friday"],
                "amazon.nova-lite-v1:0",
                "analysis@v2"))
            .Then(new AnalysisSummaryRecorded(Id,
                "We discussed the login bug.",
                ["Login fails on Friday", "Owner is Alice"],
                ["Ship the fix by Friday"],
                "amazon.nova-lite-v1:0",
                "analysis@v2"));
    }

    [Fact]
    public void ReRecordingReplacesSummaryAndBothEventsRemainInTheStream()
    {
        Spec
            .Given<Note>(
                new NoteCreated(Id),
                new AnalysisSummaryRecorded(Id, "First pass", ["old point"], ["old decision"], "model", "analysis@v2"))
            .When(new RecordAnalysisSummary(Id,
                "Second pass",
                ["new point"],
                ["new decision"],
                "model",
                "analysis@v2"))
            .Then(new AnalysisSummaryRecorded(Id, "Second pass", ["new point"], ["new decision"], "model", "analysis@v2"));
    }

    [Fact]
    public void RejectsRecordingWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordAnalysisSummary(Id, "Summary", [], [], "model", "analysis@v2"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRecordingOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RecordAnalysisSummary(Id, "Summary", [], [], "model", "analysis@v2"))
            .ThenThrows<InvalidOperationException>();
    }
}
