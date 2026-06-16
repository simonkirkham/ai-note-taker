using Domain.Notes;
using Domain.Specs.Harness;

namespace Domain.Specs.Notes;

public sealed class RecordInstructionResponsesSpec
{
    static readonly NoteId Id = new(Guid.Parse("00000000-0000-0000-0000-000000000001"));

    [Fact]
    public void RecordingResponsesRaisesInstructionResponsesRecorded()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordInstructionResponses(Id,
                [new InstructionResponse("add an agenda for the weekend", "1. Review actions\n2. Plan next week")],
                "amazon.nova-lite-v1:0",
                "analysis@v7"))
            .Then(new InstructionResponsesRecorded(Id,
                [new InstructionResponse("add an agenda for the weekend", "1. Review actions\n2. Plan next week")],
                "amazon.nova-lite-v1:0",
                "analysis@v7"));
    }

    [Fact]
    public void RecordingMultipleResponsesPreservesOrder()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordInstructionResponses(Id,
                [
                    new InstructionResponse("add an agenda", "Agenda body"),
                    new InstructionResponse("draft a thank-you email", "Email body")
                ],
                "model", "analysis@v7"))
            .Then(new InstructionResponsesRecorded(Id,
                [
                    new InstructionResponse("add an agenda", "Agenda body"),
                    new InstructionResponse("draft a thank-you email", "Email body")
                ],
                "model", "analysis@v7"));
    }

    [Fact]
    public void EmptyResponsesRaisesNothing()
    {
        Spec
            .Given<Note>(new NoteCreated(Id))
            .When(new RecordInstructionResponses(Id, [], "model", "analysis@v7"))
            .Then();
    }

    [Fact]
    public void RejectsRecordingWhenNoteDoesNotExist()
    {
        Spec
            .Given<Note>()
            .When(new RecordInstructionResponses(Id,
                [new InstructionResponse("do a thing", "done")], "model", "analysis@v7"))
            .ThenThrows<InvalidOperationException>();
    }

    [Fact]
    public void RejectsRecordingOnDeletedNote()
    {
        Spec
            .Given<Note>(new NoteCreated(Id), new NoteDeleted(Id))
            .When(new RecordInstructionResponses(Id,
                [new InstructionResponse("do a thing", "done")], "model", "analysis@v7"))
            .ThenThrows<InvalidOperationException>();
    }
}
