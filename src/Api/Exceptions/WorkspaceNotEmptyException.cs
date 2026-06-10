using Domain.Workspaces;

namespace Api.Exceptions;

// A workspace that still holds an active note cannot be deleted (23-C). The HTTP
// handler maps it to 409. Derives from InvalidOperationException so the command
// instrumentation counts it as a domain violation, not a 500.
public sealed class WorkspaceNotEmptyException(WorkspaceId workspaceId)
    : InvalidOperationException($"Workspace {workspaceId} is not empty.");
