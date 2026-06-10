using Domain.Workspaces;

namespace EventStore.Projections;

public record WorkspaceListView(WorkspaceId WorkspaceId, string Name, DateTimeOffset CreatedAt, string UserId = "");
