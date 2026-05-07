namespace Domain.ActionItems;

public readonly record struct ActionId(Guid Value)
{
    public string ToStreamId() => $"action#{this}";
    public override string ToString() => Value.ToString();
}
