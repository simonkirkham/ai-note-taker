using Api.Auth;
using Api.Handlers;

namespace Api.Endpoints;

public static class TodoEndpoints
{
    public static void MapTodoEndpoints(this WebApplication app)
    {
        // Workspace-scoped under `/w/{workspaceId}` only; the group validates ownership
        // before the handler. The rootless fallback was removed in 23-G.
        MapTodoRoutes(app.MapGroup("/w/{workspaceId}").AddEndpointFilter<WorkspaceValidationFilter>());
    }

    private static void MapTodoRoutes(IEndpointRouteBuilder routes)
    {
        routes.MapGet("/todos", TodoHandlers.GetTodos).RequireAuthorization();
        routes.MapPost("/todos", TodoHandlers.AddTodo).RequireAuthorization();
        routes.MapPost("/todos/reorder", TodoHandlers.ReorderTodos).RequireAuthorization();
        routes.MapPost("/todos/{todoId:guid}/complete", TodoHandlers.CompleteTodo).RequireAuthorization();
        routes.MapPost("/todos/{todoId:guid}/reopen", TodoHandlers.ReopenTodo).RequireAuthorization();
        routes.MapDelete("/todos/{todoId:guid}", TodoHandlers.DeleteTodo).RequireAuthorization();
    }
}
