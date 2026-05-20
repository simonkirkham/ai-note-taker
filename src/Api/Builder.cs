using Amazon.DynamoDBv2;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.CommandHandlers;
using Api.EventHandlers;
using Api.HealthChecks;
using Api.Projections;
using Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Api;

public static class Builder
{
    internal static WebApplication BuildApp(string[] args, string eventTableName, string projTableName, string noteDetailTableName, string noteActionsTableName, string todoListTableName, string noteCardListTableName, string folderTreeTableName, string tagIndexTableName)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddCors();
        builder.Services.AddHttpContextAccessor();

        var googleClientId = Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID") ?? "";
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.Authority = "https://accounts.google.com";
                if (!string.IsNullOrEmpty(googleClientId))
                    options.Audience = googleClientId;
                options.TokenValidationParameters.ValidIssuers =
                [
                    "https://accounts.google.com",
                    "accounts.google.com"
                ];
            });
        builder.Services.AddAuthorization();
        builder.Services.AddScoped<ICurrentUser, CurrentUser>();

        // Configure AmazonDynamoDB client with reduced timeouts (seconds).
        // Set DYNAMO_TIMEOUT_SECONDS env var to override the default (5s).
        var dynamoTimeoutSeconds = 5;
        if (int.TryParse(Environment.GetEnvironmentVariable("DYNAMO_TIMEOUT_SECONDS"), out var t) && t > 0)
            dynamoTimeoutSeconds = t;

        var dynamoConfig = new AmazonDynamoDBConfig
        {
            Timeout = TimeSpan.FromSeconds(dynamoTimeoutSeconds)
        };

        var awsServiceUrl = Environment.GetEnvironmentVariable("DYNAMO_SERVICE_URL") ?? builder.Configuration["AWS:ServiceURL"];
        var awsRegion = Environment.GetEnvironmentVariable("AWS_REGION") ?? builder.Configuration["AWS:AuthenticationRegion"] ?? Environment.GetEnvironmentVariable("AWS_DEFAULT_REGION");

        if (!string.IsNullOrWhiteSpace(awsServiceUrl) || !string.IsNullOrWhiteSpace(awsRegion))
        {
            if (!string.IsNullOrWhiteSpace(awsServiceUrl))
                dynamoConfig.ServiceURL = awsServiceUrl;
            if (!string.IsNullOrWhiteSpace(awsRegion))
                dynamoConfig.AuthenticationRegion = awsRegion;

            builder.Services.AddSingleton<IAmazonDynamoDB>(sp => new AmazonDynamoDBClient(dynamoConfig));
        }
        else
        {
            builder.Services.AddAWSService<IAmazonDynamoDB>();
        }
        builder.Services.AddSingleton<IEventStore>(sp =>
            new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
        builder.Services.AddSingleton<INoteTitleListStore>(sp =>
            new NoteTitleListStore(sp.GetRequiredService<IAmazonDynamoDB>(), projTableName));
        builder.Services.AddSingleton<INoteDetailStore>(sp =>
            new DynamoDbNoteDetailStore(sp.GetRequiredService<IAmazonDynamoDB>(), noteDetailTableName));
        builder.Services.AddSingleton<INoteActionsStore>(sp =>
            new DynamoDbNoteActionsStore(sp.GetRequiredService<IAmazonDynamoDB>(), noteActionsTableName));
        builder.Services.AddSingleton<ITodoListStore>(sp =>
            new DynamoDbTodoListStore(sp.GetRequiredService<IAmazonDynamoDB>(), todoListTableName));
        builder.Services.AddSingleton<INoteCardListStore>(sp =>
            new DynamoDbNoteCardListStore(sp.GetRequiredService<IAmazonDynamoDB>(), noteCardListTableName));
        builder.Services.AddSingleton<IFolderTreeStore>(sp =>
            new DynamoDbFolderTreeStore(sp.GetRequiredService<IAmazonDynamoDB>(), folderTreeTableName));
        builder.Services.AddSingleton<ITagIndexStore>(sp =>
            new DynamoDbTagIndexStore(sp.GetRequiredService<IAmazonDynamoDB>(), tagIndexTableName));
        builder.Services.AddSingleton<IDomainEventHandler, NoteTitleListEventHandler>();
        builder.Services.AddSingleton<IDomainEventHandler, NoteDetailEventHandler>();
        builder.Services.AddSingleton<IDomainEventHandler, NoteCardListEventHandler>();
        builder.Services.AddSingleton<IDomainEventHandler, TodoListEventHandler>();
        builder.Services.AddSingleton<IDomainEventHandler, TagIndexEventHandler>();
        builder.Services.AddSingleton<IDomainEventDispatcher, DomainEventDispatcher>();
        builder.Services.AddScoped<INoteCommandHandler, NoteCommandHandler>();
        builder.Services.AddScoped<IActionItemCommandHandler, ActionItemCommandHandler>();
        builder.Services.AddScoped<IFolderCommandHandler, FolderCommandHandler>();
        builder.Services.AddScoped<IProjectionRebuildHandler, ProjectionRebuildHandler>();
        builder.Services.AddSingleton<IDynamoHealthCheck>(sp =>
            new DynamoDbHealthCheck(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
        builder.Services.AddSingleton<IGoogleCalendarClient, GoogleCalendarClient>();
        builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

        return builder.Build();
    }
}