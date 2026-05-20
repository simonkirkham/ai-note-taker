using Api.Handlers;

namespace Api.Endpoints;

public static class TodoEndpoints
{
    public static void MapTodoEndpoints(this WebApplication app)
    {
        app.MapGet("/todos", TodoHandlers.GetTodos).RequireAuthorization();
        app.MapPost("/todos", TodoHandlers.AddTodo).RequireAuthorization();
        app.MapPost("/todos/{todoId:guid}/complete", TodoHandlers.CompleteTodo).RequireAuthorization();
        app.MapPost("/todos/{todoId:guid}/reopen", TodoHandlers.ReopenTodo).RequireAuthorization();
        app.MapDelete("/todos/{todoId:guid}", TodoHandlers.DeleteTodo).RequireAuthorization();
    }
}
