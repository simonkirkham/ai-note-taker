namespace Domain.Notes;

public readonly record struct NoteId(Guid Value)
{
    public override string ToString() => Value.ToString();
}
