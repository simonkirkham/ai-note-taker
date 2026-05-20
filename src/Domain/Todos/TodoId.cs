namespace Domain.Todos;

public readonly record struct TodoId(Guid Value)
{
    public string ToStreamId() => $"todo#{this}";
    public override string ToString() => Value.ToString();
}
