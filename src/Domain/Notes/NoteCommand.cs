namespace Domain.Notes;

public abstract record NoteCommand : ICommand
{
    public abstract NoteId NoteId { get; init; }
    public virtual bool MustExist => true;
}
