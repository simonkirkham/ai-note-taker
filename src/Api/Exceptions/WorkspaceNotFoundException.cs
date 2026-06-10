using Domain.Workspaces;

namespace Api.Exceptions;

public sealed class WorkspaceNotFoundException(WorkspaceId workspaceId) : Exception($"Workspace {workspaceId} not found.");
