namespace Domain.Notes;

public record CreateNote(NoteId NoteId) : NoteCommand
{
    public override bool MustExist => false;
}
