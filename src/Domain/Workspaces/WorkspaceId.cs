namespace Domain.Workspaces;

public readonly record struct WorkspaceId(string Value)
{
    public const string DefaultValue = "__default__";

    public static WorkspaceId Default => new(DefaultValue);

    public bool IsDefault => Value == DefaultValue;

    public string ToStreamId() => $"workspace-{Value}";

    public override string ToString() => Value;
}
