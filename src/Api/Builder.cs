using Amazon.BedrockRuntime;
using Amazon.DynamoDBv2;
using Amazon.S3;
using Amazon.SecurityToken;
using Amazon.XRay.Recorder.Core;
using Amazon.XRay.Recorder.Core.Strategies;
using Amazon.XRay.Recorder.Handlers.AwsSdk;
using AWS.Lambda.Powertools.Logging;
using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.CommandHandlers;
using Api.HealthChecks;
using Api.Observability;
using Api.Projections;
using Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Api;

public static class Builder
{
    internal static WebApplication BuildApp(string[] args, string eventTableName, string projTableName, string noteDetailTableName, string noteActionsTableName, string todoListTableName, string noteCardListTableName, string folderTreeTableName, string tagIndexTableName, string tagFeedbackTableName, string actionFeedbackTableName, string calendarLinkTableName, string noteSearchViewTableName, string draftTranscriptionTableName, string workspaceListTableName)
    {
        var builder = WebApplication.CreateBuilder(args);

        // LogEvent is intentionally left off: logging the Lambda event would
        // capture the Authorization bearer token.
        builder.Logging.ClearProviders();
        builder.Logging.AddPowertoolsLogger(config =>
        {
            config.Service = "note-taker";
        });

        // This API authenticates with bearer tokens only — no cookies, antiforgery, or
        // IDataProtector consumers — so ASP.NET Data Protection is unused. On Lambda it
        // has no persistent key store and logs three Warning lines per cold start about
        // its ephemeral in-memory key ring. They are pure noise that drowns out real
        // errors on the ops dashboard, so suppress the category below Error. (BUG-3)
        builder.Logging.AddFilter("Microsoft.AspNetCore.DataProtection", LogLevel.Error);

        // X-Ray instruments all AWS SDK calls (DynamoDB, STS, Bedrock) as trace
        // subsegments. Must run before any AWS client is constructed. Off Lambda
        // (local, tests) there is no active segment, so log rather than throw on
        // missing context.
        AWSXRayRecorder.Instance.ContextMissingStrategy = ContextMissingStrategy.LOG_ERROR;
        AWSSDKHandler.RegisterXRayForAllServices();

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
        builder.Services.AddScoped<ICurrentWorkspace, CurrentWorkspace>();

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
        builder.Services.AddSingleton<IDomainMetrics, PowertoolsDomainMetrics>();

        // The deployed API Lambda has NO projection decorator: the DynamoDB stream + Projector
        // Lambda (27-B) build read models asynchronously, and this function's IAM grants no
        // projection-table access. In-process hosts (local Kestrel) have no async projector, so
        // they wrap the event store with SyncProjectingEventStore — the SAME StreamProjector path
        // that runs async in prod, giving immediate read-after-write without inline writes. Inline
        // projection in the command handlers is gone, so exactly one of {deployed-async, in-process
        // decorator} writes the read models — never both.
        var inLambda = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME"));
        if (inLambda)
        {
            builder.Services.AddSingleton<IEventStore>(sp =>
                new InstrumentedEventStore(
                    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName),
                    sp.GetRequiredService<IDomainMetrics>(),
                    sp.GetRequiredService<ILogger<InstrumentedEventStore>>()));
        }
        else
        {
            builder.Services.AddSingleton<IEventStore>(sp =>
            {
                var baseStore = new InstrumentedEventStore(
                    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName),
                    sp.GetRequiredService<IDomainMetrics>(),
                    sp.GetRequiredService<ILogger<InstrumentedEventStore>>());
                // Construct a fresh ProjectionUpdater from the singleton stores rather than
                // resolving the scoped IProjectionUpdater — resolving a scoped service from the
                // root provider is a captive dependency. The projector re-reads from baseStore,
                // the same instance the decorator appends to (do NOT resolve IEventStore from sp
                // here — that would recurse into this very factory).
                var updater = BuildProjectionUpdater(sp);
                var projector = new StreamProjector(
                    baseStore, updater, new InMemoryProcessedPositionStore(), new NoOpProjectorMetrics(),
                    sp.GetRequiredService<ILogger<StreamProjector>>());
                return new SyncProjectingEventStore(baseStore, projector);
            });
        }
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
        builder.Services.AddSingleton<ITagFeedbackStore>(sp =>
            new DynamoDbTagFeedbackStore(sp.GetRequiredService<IAmazonDynamoDB>(), tagFeedbackTableName));
        builder.Services.AddSingleton<IActionItemFeedbackStore>(sp =>
            new DynamoDbActionItemFeedbackStore(sp.GetRequiredService<IAmazonDynamoDB>(), actionFeedbackTableName));
        builder.Services.AddSingleton<ICalendarLinkIndexStore>(sp =>
            new DynamoDbCalendarLinkIndexStore(sp.GetRequiredService<IAmazonDynamoDB>(), calendarLinkTableName));
        builder.Services.AddSingleton<INoteSearchViewStore>(sp =>
            new DynamoDbNoteSearchViewStore(sp.GetRequiredService<IAmazonDynamoDB>(), noteSearchViewTableName));
        builder.Services.AddSingleton<ITranscriptionDraftStore>(sp =>
            new DynamoDbTranscriptionDraftStore(sp.GetRequiredService<IAmazonDynamoDB>(), draftTranscriptionTableName));
        builder.Services.AddSingleton<IWorkspaceListStore>(sp =>
            new DynamoDbWorkspaceListStore(sp.GetRequiredService<IAmazonDynamoDB>(), workspaceListTableName));
        builder.Services.AddScoped<IProjectionUpdater, ProjectionUpdater>();
        builder.Services.AddScoped<INoteCommandHandler, NoteCommandHandler>();
        builder.Services.AddScoped<IActionItemCommandHandler, ActionItemCommandHandler>();
        builder.Services.AddScoped<ITodoCommandHandler, TodoCommandHandler>();
        builder.Services.AddScoped<IFolderCommandHandler, FolderCommandHandler>();
        builder.Services.AddScoped<IWorkspaceCommandHandler, WorkspaceCommandHandler>();
        builder.Services.AddScoped<IProjectionRebuildHandler, ProjectionRebuildHandler>();
        builder.Services.AddSingleton<IDynamoHealthCheck>(sp =>
            new DynamoDbHealthCheck(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("STUB_CALENDAR_JSON")))
            builder.Services.AddSingleton<IGoogleCalendarClient, StubGoogleCalendarClient>();
        else
            builder.Services.AddSingleton<IGoogleCalendarClient, GoogleCalendarClient>();
        builder.Services.AddHttpClient<IGoogleOAuthClient, GoogleOAuthClient>(c => c.Timeout = TimeSpan.FromSeconds(10));
        builder.Services.AddAWSService<IAmazonSecurityTokenService>();
        builder.Services.AddSingleton<IStsCredentialService, StsCredentialService>();
        builder.Services.AddAWSService<IAmazonBedrockRuntime>();
        builder.Services.AddSingleton<IBedrockAnalysisService>(sp =>
            new BedrockAnalysisService(
                sp.GetRequiredService<IAmazonBedrockRuntime>(),
                sp.GetRequiredService<ILogger<BedrockAnalysisService>>(),
                PromptCatalog.Current,
                Environment.GetEnvironmentVariable("BEDROCK_MODEL_ID") ?? ""));
        builder.Services.AddAWSService<IAmazonS3>();
        var imageBucketName = Environment.GetEnvironmentVariable("IMAGE_BUCKET_NAME") ?? "";
        builder.Services.AddSingleton<INoteImageStore>(sp =>
            new S3NoteImageStore(sp.GetRequiredService<IAmazonS3>(), imageBucketName));
        builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

        return builder.Build();
    }

    // Builds a ProjectionUpdater from the registered singleton stores. Used by the in-process
    // sync decorator (local Kestrel); the scoped IProjectionUpdater registration is for the
    // rebuild handler and the Projector Lambda.
    private static ProjectionUpdater BuildProjectionUpdater(IServiceProvider sp) => new(
        sp.GetRequiredService<INoteTitleListStore>(),
        sp.GetRequiredService<INoteDetailStore>(),
        sp.GetRequiredService<ITodoListStore>(),
        sp.GetRequiredService<INoteCardListStore>(),
        sp.GetRequiredService<INoteActionsStore>(),
        sp.GetRequiredService<ITagIndexStore>(),
        sp.GetRequiredService<ITagFeedbackStore>(),
        sp.GetRequiredService<IActionItemFeedbackStore>(),
        sp.GetRequiredService<ICalendarLinkIndexStore>(),
        sp.GetRequiredService<INoteSearchViewStore>(),
        sp.GetRequiredService<IFolderTreeStore>(),
        sp.GetRequiredService<IWorkspaceListStore>(),
        sp.GetRequiredService<Api.Services.INoteImageStore>(),
        sp.GetRequiredService<ILogger<ProjectionUpdater>>());
}