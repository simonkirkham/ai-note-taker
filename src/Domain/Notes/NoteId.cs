namespace Domain.Notes;

public readonly record struct NoteId(Guid Value)
{
    public string ToStreamId() => $"note#{this}";
    public override string ToString() => Value.ToString();
}
