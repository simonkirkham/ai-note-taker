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
using Api.Consistency;
using Api.HealthChecks;
using Api.Observability;
using Api.Projections;
using Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;

namespace Api;

public static class Builder
{
    internal static WebApplication BuildApp(string[] args, string eventTableName, string projTableName, string noteDetailTableName, string noteActionsTableName, string todoListTableName, string noteCardListTableName, string folderTreeTableName, string tagIndexTableName, string tagFeedbackTableName, string actionFeedbackTableName, string calendarLinkTableName, string noteSearchViewTableName, string draftTranscriptionTableName, string workspaceListTableName, string projPositionTableName, string authTokensTableName)
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

        // Read-your-writes (RYW-1). The deployed API Lambda and the in-process hosts (local
        // Kestrel) diverge here:
        //  - Deployed (inLambda): the DynamoDB stream + Projector Lambda build read models
        //    asynchronously, so the API has NO projection decorator — a plain
        //    InstrumentedEventStore(DynamoDbEventStore). The gate polls the SAME DynamoDB
        //    proj-position table the Projector Lambda advances.
        //  - In-process (!inLambda): no async projector, so the event store is wrapped with
        //    SyncProjectingEventStore driving the SAME StreamProjector path, and ONE
        //    InMemoryProcessedPositionStore is shared between that projector and the gate — the
        //    gate must see the advance the decorator's projector writes, or it would wait the
        //    full cap on every read.
        var inLambda = !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME"));
        if (inLambda)
        {
            builder.Services.AddSingleton<IProcessedPositionStore>(sp =>
                new DynamoDbProcessedPositionStore(sp.GetRequiredService<IAmazonDynamoDB>(), projPositionTableName));
            builder.Services.AddSingleton<IEventStore>(sp =>
                new InstrumentedEventStore(
                    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName),
                    sp.GetRequiredService<IDomainMetrics>(),
                    sp.GetRequiredService<ILogger<InstrumentedEventStore>>()));
        }
        else
        {
            // One shared position store: the gate resolves it as IProcessedPositionStore, and the
            // SAME instance drives the decorator's projector — so the gate sees each apply.
            builder.Services.AddSingleton<IProcessedPositionStore, InMemoryProcessedPositionStore>();
            builder.Services.AddSingleton<IEventStore>(sp =>
            {
                var baseStore = new InstrumentedEventStore(
                    new DynamoDbEventStore(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName),
                    sp.GetRequiredService<IDomainMetrics>(),
                    sp.GetRequiredService<ILogger<InstrumentedEventStore>>());
                // Build a fresh ProjectionUpdater from the singleton stores rather than resolving
                // the scoped IProjectionUpdater into this singleton (a captive dependency). The
                // projector re-reads from baseStore — the same instance the decorator appends to
                // (do NOT resolve IEventStore from sp here, which would recurse into this factory).
                var updater = BuildProjectionUpdater(sp);
                var projector = new StreamProjector(
                    baseStore, updater, sp.GetRequiredService<IProcessedPositionStore>(),
                    new NoOpProjectorMetrics(), sp.GetRequiredService<ILogger<StreamProjector>>());
                return new SyncProjectingEventStore(baseStore, projector);
            });
        }
        builder.Services.AddSingleton<IConsistencyGate>(sp =>
            new ConsistencyGate(
                sp.GetRequiredService<IProcessedPositionStore>(),
                sp.GetService<ILogger<ConsistencyGate>>()));
        // Strongly-consistent note ownership for note-scoped handlers (event-stream, not the async
        // projection). Scoped to match IEventStore's per-request lifetime.
        builder.Services.AddScoped<Api.Auth.INoteAuthorizer, Api.Auth.NoteAuthorizer>();
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
        builder.Services.AddScoped<INoteCommandHandler, NoteCommandHandler>();
        builder.Services.AddScoped<IActionItemCommandHandler, ActionItemCommandHandler>();
        builder.Services.AddScoped<ITodoCommandHandler, TodoCommandHandler>();
        builder.Services.AddScoped<IFolderCommandHandler, FolderCommandHandler>();
        builder.Services.AddScoped<IWorkspaceCommandHandler, WorkspaceCommandHandler>();
        builder.Services.AddScoped<IProjectionRebuildHandler, ProjectionRebuildHandler>();
        builder.Services.AddSingleton<IDynamoHealthCheck>(sp =>
            new DynamoDbHealthCheck(sp.GetRequiredService<IAmazonDynamoDB>(), eventTableName));
        Api.Services.CalendarClientRegistration.Register(builder.Services);
        builder.Services.AddHttpClient<IGoogleOAuthClient, GoogleOAuthClient>(c => c.Timeout = TimeSpan.FromSeconds(10));
        builder.Services.AddSingleton<IRefreshTokenStore>(sp =>
            new DynamoDbRefreshTokenStore(sp.GetRequiredService<IAmazonDynamoDB>(), authTokensTableName));
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
        var recordingsBucketName = Environment.GetEnvironmentVariable("RECORDINGS_BUCKET_NAME") ?? "";
        builder.Services.AddSingleton<INoteRecordingStore>(sp =>
            new S3NoteRecordingStore(sp.GetRequiredService<IAmazonS3>(), recordingsBucketName));
        builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

        return builder.Build();
    }

    // SnapStart takes the snapshot at the end of init, before any request exercises the
    // pipeline — so the first request after each restore pays ~7 s of JIT + first-use init
    // (measured in prod X-Ray 2026-06-12; see TI-32). This hook runs that warmup during
    // snapshot creation, so the cost is captured in the snapshot rather than paid live on the
    // first invocation. Off-Lambda (local Kestrel, tests) the hook is never invoked.
    public static void RegisterSnapStartPriming(WebApplication app)
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME")))
            return;

        Amazon.Lambda.Core.SnapshotRestore.RegisterBeforeSnapshot(async () =>
        {
            try
            {
                // Warm the AWS SDK request pipeline: credential-provider chain + DynamoDB
                // marshallers + HTTP/JSON machinery. The JIT'd code is captured in the
                // snapshot; the TLS connection is re-established after restore, but the
                // expensive one-off first-use initialisation is not repeated.
                using var scope = app.Services.CreateScope();
                await scope.ServiceProvider.GetRequiredService<IDynamoHealthCheck>()
                    .CheckAsync().ConfigureAwait(false);

                // Warm System.Text.Json: the converter factory + per-type metadata cache are
                // built on first serialize and are NOT covered by ReadyToRun (TI-35).
                System.Text.Json.JsonSerializer.Serialize(
                    new { id = "warm", title = "warm", items = new[] { new { a = 1, b = "x" } } });
            }
            catch (Exception ex)
            {
                // Best-effort: priming must never fail snapshot creation — but surface a
                // broken warm path in CloudWatch rather than swallowing it silently.
                app.Logger.LogWarning(ex, "SnapStart priming hook failed; cold-start latency may regress.");
            }
        });
    }

    // Builds a ProjectionUpdater from the registered singleton stores for the in-process sync
    // decorator (test harness + local Kestrel) to drive the StreamProjector — built by hand rather
    // than DI-resolved to avoid a captive scoped dependency inside the singleton decorator. The API
    // host has no other consumer of IProjectionUpdater (command handlers are append-only since
    // Phase 27-RYW; ProjectionRebuildHandler folds via its own stores), so there is no DI
    // registration for it here — only the Projector Lambda (a separate host) registers one.
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