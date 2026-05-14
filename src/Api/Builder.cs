using Amazon.DynamoDBv2;
using Api;
using EventStore;
using EventStore.Projections;

namespace Api;

public class Builder
{
    internal static WebApplication BuildApp(string[] args, string eventTableName, string projTableName, string noteDetailTableName, string noteActionsTableName, string todoListTableName, string noteCardListTableName)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddCors();

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
        builder.Services.AddSingleton<NoteCommandHandler>();
        builder.Services.AddSingleton<ActionItemCommandHandler>();
        builder.Services.AddSingleton<ProjectionRebuildHandler>();
        builder.Services.AddSingleton<IDynamoHealthCheck>(sp =>
            new DynamoDbHealthCheck(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
        builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

        return builder.Build();
    }
}