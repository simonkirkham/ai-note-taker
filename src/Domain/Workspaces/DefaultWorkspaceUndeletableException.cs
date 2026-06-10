namespace Domain.Workspaces;

// The reserved default workspace is synthesised at read time and can never be
// deleted. Derives from InvalidOperationException so the command instrumentation
// counts it as a domain violation; the HTTP handler maps it to 409.
public sealed class DefaultWorkspaceUndeletableException : InvalidOperationException
{
    public DefaultWorkspaceUndeletableException() : base("The default workspace cannot be deleted.") { }
}
