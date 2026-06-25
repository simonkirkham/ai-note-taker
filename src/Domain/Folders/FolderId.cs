namespace Domain.Folders;

public readonly record struct FolderId(Guid Value)
{
    public string ToStreamId() => $"folder-{Value:N}";
    public override string ToString() => Value.ToString();
}
