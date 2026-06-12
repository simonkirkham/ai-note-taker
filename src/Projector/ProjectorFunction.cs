using Amazon.DynamoDBv2;
using Amazon.Lambda.Core;
using Amazon.Lambda.DynamoDBEvents;
using Amazon.S3;
using EventStore;
using EventStore.Projections;
using Api.Projections;
using Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.SystemTextJson.DefaultLambdaJsonSerializer))]

namespace Projector;

// The async Projector Lambda: triggered by the DynamoDB stream on the event store, it
// rebuilds read models off the log via the shared ProjectionUpdater. Shadow mode in 27-B —
// the command handlers still update projections inline, so this runs redundantly and
// idempotently; reads are unaffected. The slim DI graph deliberately excludes ASP.NET,
// auth, Bedrock, STS, Calendar and the draft store — the projector only folds events.
public sealed class ProjectorFunction
{
    private readonly StreamProjector _projector;
    private readonly IProjectorMetrics _metrics;
    private readonly ILogger<ProjectorFunction> _logger;

    public ProjectorFunction() : this(BuildServices()) { }

    // Test seam: inject an in-memory service graph.
    public ProjectorFunction(IServiceProvider services)
    {
        _projector = services.GetRequiredService<StreamProjector>();
        _metrics = services.GetRequiredService<IProjectorMetrics>();
        _logger = services.GetRequiredService<ILogger<ProjectorFunction>>();
    }

    public async Task Handle(DynamoDBEvent dynamoEvent, ILambdaContext context)
    {
        var streamIds = dynamoEvent.Records
            .Select(StreamRecordMapper.TryGetEventStreamId)
            .Where(id => id is not null)
            .Select(id => id!)
            .Distinct()
            .ToList();
        if (streamIds.Count == 0) return;

        try
        {
            await _projector.ProcessStreamsAsync(streamIds).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            // Surface the failure so the event-source mapping bisects the batch and routes
            // the poison record to the DLQ — an async projection failure is otherwise silent.
            _metrics.Failure();
            _logger.LogError(ex, "Projector batch failed ({Count} streams)", streamIds.Count);
            throw;
        }
    }

    private static IServiceProvider BuildServices()
    {
        var services = new ServiceCollection();
        services.AddLogging(b => b.AddJsonConsole());
        services.AddSingleton<IAmazonDynamoDB>(_ => new AmazonDynamoDBClient());
        services.AddSingleton<IAmazonS3>(_ => new AmazonS3Client());

        services.AddSingleton<IEventStore>(sp => new DynamoDbEventStore(Dynamo(sp), Env("EVENTS_TABLE_NAME")));
        services.AddSingleton<INoteTitleListStore>(sp => new NoteTitleListStore(Dynamo(sp), Env("PROJ_NOTETITLELIST_TABLE_NAME")));
        services.AddSingleton<INoteDetailStore>(sp => new DynamoDbNoteDetailStore(Dynamo(sp), Env("PROJ_NOTEDETAIL_TABLE_NAME")));
        services.AddSingleton<INoteActionsStore>(sp => new DynamoDbNoteActionsStore(Dynamo(sp), Env("PROJ_NOTEACTIONS_TABLE_NAME")));
        services.AddSingleton<ITodoListStore>(sp => new DynamoDbTodoListStore(Dynamo(sp), Env("PROJ_TODOLIST_TABLE_NAME")));
        services.AddSingleton<INoteCardListStore>(sp => new DynamoDbNoteCardListStore(Dynamo(sp), Env("PROJ_NOTECARDLIST_TABLE_NAME")));
        services.AddSingleton<IFolderTreeStore>(sp => new DynamoDbFolderTreeStore(Dynamo(sp), Env("PROJ_FOLDERTREE_TABLE_NAME")));
        services.AddSingleton<ITagIndexStore>(sp => new DynamoDbTagIndexStore(Dynamo(sp), Env("PROJ_TAGINDEX_TABLE_NAME")));
        services.AddSingleton<ITagFeedbackStore>(sp => new DynamoDbTagFeedbackStore(Dynamo(sp), Env("PROJ_TAGFEEDBACK_TABLE_NAME")));
        services.AddSingleton<IActionItemFeedbackStore>(sp => new DynamoDbActionItemFeedbackStore(Dynamo(sp), Env("PROJ_ACTIONFEEDBACK_TABLE_NAME")));
        services.AddSingleton<ICalendarLinkIndexStore>(sp => new DynamoDbCalendarLinkIndexStore(Dynamo(sp), Env("PROJ_CALENDARLINKINDEX_TABLE_NAME")));
        services.AddSingleton<INoteSearchViewStore>(sp => new DynamoDbNoteSearchViewStore(Dynamo(sp), Env("PROJ_NOTESEARCHVIEW_TABLE_NAME")));
        services.AddSingleton<IWorkspaceListStore>(sp => new DynamoDbWorkspaceListStore(Dynamo(sp), Env("PROJ_WORKSPACELIST_TABLE_NAME")));
        services.AddSingleton<IProcessedPositionStore>(sp => new DynamoDbProcessedPositionStore(Dynamo(sp), Env("PROJ_POSITION_TABLE_NAME")));
        services.AddSingleton<INoteImageStore>(sp => new S3NoteImageStore(sp.GetRequiredService<IAmazonS3>(), Env("IMAGE_BUCKET_NAME")));

        // Singleton (vs the API's scoped updater) is safe: the projector processes one batch
        // sequentially per invocation and every store is stateless, so there is no per-request
        // state to scope.
        services.AddSingleton<IProjectorMetrics, ProjectorMetrics>();
        services.AddSingleton<IProjectionUpdater, ProjectionUpdater>();
        services.AddSingleton<StreamProjector>();

        return services.BuildServiceProvider();
    }

    private static IAmazonDynamoDB Dynamo(IServiceProvider sp) => sp.GetRequiredService<IAmazonDynamoDB>();

    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name) ?? throw new InvalidOperationException($"{name} is not set.");
}
