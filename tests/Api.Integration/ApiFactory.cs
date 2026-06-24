using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.HealthChecks;
using Api.Projections;
using Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Api.Integration;

public class ApiFactory : WebApplicationFactory<Program>
{
    static ApiFactory()
    {
        Environment.SetEnvironmentVariable("EVENTS_TABLE_NAME", "test-events");
        Environment.SetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME", "test-proj");
        Environment.SetEnvironmentVariable("PROJ_NOTEDETAIL_TABLE_NAME", "test-proj-notedetail");
        Environment.SetEnvironmentVariable("PROJ_NOTEACTIONS_TABLE_NAME", "test-proj-noteactions");
        Environment.SetEnvironmentVariable("PROJ_TODOLIST_TABLE_NAME", "test-proj-todolist");
        Environment.SetEnvironmentVariable("PROJ_NOTECARDLIST_TABLE_NAME", "test-proj-notecardlist");
        Environment.SetEnvironmentVariable("PROJ_FOLDERTREE_TABLE_NAME", "test-proj-foldertree");
        Environment.SetEnvironmentVariable("PROJ_TAGINDEX_TABLE_NAME", "test-proj-tagindex");
        Environment.SetEnvironmentVariable("PROJ_TAGFEEDBACK_TABLE_NAME", "test-proj-tagfeedback");
        Environment.SetEnvironmentVariable("PROJ_ACTIONFEEDBACK_TABLE_NAME", "test-proj-actionfeedback");
        Environment.SetEnvironmentVariable("PROJ_CALENDARLINKINDEX_TABLE_NAME", "test-proj-calendarlinkindex");
        Environment.SetEnvironmentVariable("PROJ_NOTESEARCHVIEW_TABLE_NAME", "test-proj-notesearchview");
        Environment.SetEnvironmentVariable("DRAFT_TRANSCRIPTION_TABLE_NAME", "test-draft-transcription");
        Environment.SetEnvironmentVariable("PROJ_WORKSPACELIST_TABLE_NAME", "test-proj-workspacelist");
        Environment.SetEnvironmentVariable("PROJ_POSITION_TABLE_NAME", "test-proj-position");
        Environment.SetEnvironmentVariable("AUTH_TOKENS_TABLE_NAME", "test-auth-tokens");
        Environment.SetEnvironmentVariable("CALENDAR_TOKENS_TABLE_NAME", "test-calendar-tokens");
        Environment.SetEnvironmentVariable("ALLOWED_USER_SUBS", "test-user-123,other-user-456");
        Environment.SetEnvironmentVariable("GOOGLE_CLIENT_ID", "test-client-id");
        Environment.SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", "test-client-secret");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            // 23-G removed the rootless content routes (everything is `/w/{wsId}`-only). Most
            // integration tests call un-prefixed scoped paths (e.g. "/notes") for brevity; this
            // server-side filter rewrites those to the default workspace before routing, so the
            // tests exercise the real prefixed routes. It covers every client uniformly —
            // including `WithWebHostBuilder`-derived ones, which bypass a per-client handler.
            // Set the `X-Test-No-Prefix` header to opt out (used to assert rootless paths 404).
            services.AddSingleton<IStartupFilter, WorkspacePrefixStartupFilter>();
            // 34-C: handlers resolve the calendar client via ICalendarClientFactory, so override the
            // factory (not a single ICalendarClient) to always return the FakeCalendarClient. Tests
            // resolve FakeCalendarClient directly to stage events; provider-resolution logic is
            // covered separately in CalendarClientFactoryTests.
            services.AddSingleton<FakeCalendarClient>();
            services.RemoveAll<ICalendarClientFactory>();
            services.AddSingleton<ICalendarClientFactory>(sp =>
                new FixedCalendarClientFactory(sp.GetRequiredService<FakeCalendarClient>()));
            services.RemoveAll<IGoogleOAuthClient>();
            services.AddSingleton<FakeGoogleOAuthClient>();
            services.AddSingleton<IGoogleOAuthClient>(sp => sp.GetRequiredService<FakeGoogleOAuthClient>());
            services.RemoveAll<IMicrosoftOAuthClient>();
            services.AddSingleton<FakeMicrosoftOAuthClient>();
            services.AddSingleton<IMicrosoftOAuthClient>(sp => sp.GetRequiredService<FakeMicrosoftOAuthClient>());
            services.RemoveAll<IRefreshTokenStore>();
            services.AddSingleton<InMemoryRefreshTokenStore>();
            services.AddSingleton<IRefreshTokenStore>(sp => sp.GetRequiredService<InMemoryRefreshTokenStore>());
            services.RemoveAll<ICalendarTokenStore>();
            services.AddSingleton<InMemoryCalendarTokenStore>();
            services.AddSingleton<ICalendarTokenStore>(sp => sp.GetRequiredService<InMemoryCalendarTokenStore>());
            services.RemoveAll<IEventStore>();
            services.RemoveAll<INoteTitleListStore>();
            services.RemoveAll<INoteDetailStore>();
            services.RemoveAll<INoteActionsStore>();
            services.RemoveAll<ITodoListStore>();
            services.RemoveAll<INoteCardListStore>();
            services.RemoveAll<IFolderTreeStore>();
            services.RemoveAll<ITagIndexStore>();
            services.RemoveAll<ITagFeedbackStore>();
            services.RemoveAll<IActionItemFeedbackStore>();
            services.RemoveAll<ICalendarLinkIndexStore>();
            services.RemoveAll<INoteSearchViewStore>();
            services.RemoveAll<ITranscriptionDraftStore>();
            services.RemoveAll<IWorkspaceListStore>();
            services.RemoveAll<IDynamoHealthCheck>();
            services.RemoveAll<IProcessedPositionStore>();
            // RYW-1: the command handlers no longer write the Todo projection inline. The in-process
            // host gets immediate read-after-write by wrapping the in-memory event store with
            // SyncProjectingEventStore, which drives the SAME StreamProjector path that runs async
            // off the DynamoDB stream in prod. The gate and the decorator's projector MUST share the
            // one position store (registered below) so the gate sees the projector's advance.
            services.AddSingleton<IProcessedPositionStore, InMemoryProcessedPositionStore>();
            services.AddSingleton<IEventStore>(sp => BuildSyncProjectingStore(sp, new InMemoryEventStore()));
            services.AddSingleton<INoteTitleListStore, InMemoryNoteTitleListStore>();
            services.AddSingleton<INoteDetailStore, InMemoryNoteDetailStore>();
            services.AddSingleton<INoteActionsStore, InMemoryNoteActionsStore>();
            services.AddSingleton<ITodoListStore, InMemoryTodoListStore>();
            services.AddSingleton<INoteCardListStore, InMemoryNoteCardListStore>();
            services.AddSingleton<IFolderTreeStore, InMemoryFolderTreeStore>();
            services.AddSingleton<ITagIndexStore, InMemoryTagIndexStore>();
            services.AddSingleton<ITagFeedbackStore, InMemoryTagFeedbackStore>();
            services.AddSingleton<IActionItemFeedbackStore, InMemoryActionItemFeedbackStore>();
            services.AddSingleton<ICalendarLinkIndexStore, InMemoryCalendarLinkIndexStore>();
            services.AddSingleton<INoteSearchViewStore, InMemoryNoteSearchViewStore>();
            services.AddSingleton<ITranscriptionDraftStore, InMemoryTranscriptionDraftStore>();
            services.AddSingleton<IWorkspaceListStore, InMemoryWorkspaceListStore>();
            services.AddSingleton<IDynamoHealthCheck, AlwaysHealthyDynamoCheck>();
            services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = "Test";
                options.DefaultChallengeScheme = "Test";
            })
            .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            services.RemoveAll<ICurrentUser>();
            services.AddScoped<ICurrentUser, FakeCurrentUser>();
            services.RemoveAll<IStsCredentialService>();
            services.AddSingleton<IStsCredentialService, FakeStsCredentialService>();
            services.RemoveAll<IBedrockAnalysisService>();
            services.AddSingleton<FakeBedrockAnalysisService>();
            services.AddSingleton<IBedrockAnalysisService>(sp => sp.GetRequiredService<FakeBedrockAnalysisService>());
            services.RemoveAll<Api.Services.INoteImageStore>();
            services.AddSingleton<FakeNoteImageStore>();
            services.AddSingleton<Api.Services.INoteImageStore>(sp => sp.GetRequiredService<FakeNoteImageStore>());
            services.RemoveAll<Api.Services.INoteRecordingStore>();
            services.AddSingleton<FakeNoteRecordingStore>();
            services.AddSingleton<Api.Services.INoteRecordingStore>(sp => sp.GetRequiredService<FakeNoteRecordingStore>());
            services.RemoveAll<Api.Services.ITranscriptionJobStarter>();
            services.AddSingleton<FakeTranscriptionJobStarter>();
            services.AddSingleton<Api.Services.ITranscriptionJobStarter>(sp => sp.GetRequiredService<FakeTranscriptionJobStarter>());
        });
    }

    // RYW-1: wrap an in-memory event store with the sync projector so the in-process host gets
    // immediate read-after-write through the SAME StreamProjector path that runs async in prod
    // (the Todo handler no longer writes its projection inline). The projector re-reads from the
    // same `inner` instance the decorator appends to, and resolves the SHARED IProcessedPositionStore
    // from `sp` — the same instance the consistency gate polls — so the gate sees the projector's
    // advance. Projection stores come from `sp` so a test that overrides IEventStore (e.g.
    // ConflictingEventStore) shares the factory's stores.
    public static IEventStore BuildSyncProjectingStore(IServiceProvider sp, IEventStore inner)
    {
        var updater = new ProjectionUpdater(
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
            NullLogger<ProjectionUpdater>.Instance);
        var projector = new StreamProjector(
            inner, updater, sp.GetRequiredService<IProcessedPositionStore>(), new NoOpProjectorMetrics(),
            NullLogger<StreamProjector>.Instance);
        return new SyncProjectingEventStore(inner, projector);
    }

    public const string NoPrefixHeader = "X-Test-No-Prefix";

    // Rewrites un-prefixed scoped paths to the default workspace BEFORE routing, so the
    // suite's many rootless-style calls exercise the real `/w/{wsId}` routes after 23-G.
    // Runs in the test server pipeline, so it covers every client (incl. WithWebHostBuilder).
    private sealed class WorkspacePrefixStartupFilter : IStartupFilter
    {
        // 34-B: `/calendar/*` (meetings + connect/connection/disconnect) and the meeting-note
        // creation routes are now workspace-scoped, so they are rewritten like the rest.
        private static readonly string[] ScopedPrefixes = ["/notes", "/folders", "/todos", "/tags", "/calendar"];
        // No global `/notes/*` exceptions remain since 34-B moved from-meeting/from-next-occurrence
        // under `/w/{workspaceId}`. Kept as an explicit (empty) seam for future global routes.
        private static readonly string[] GlobalExceptions = [];

        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use(async (context, nextMw) =>
            {
                var path = context.Request.Path.Value;
                if (path is not null
                    && !context.Request.Headers.ContainsKey(NoPrefixHeader)
                    && !path.StartsWith("/w/", StringComparison.Ordinal)
                    && !GlobalExceptions.Any(g => path == g || path.StartsWith(g + "/", StringComparison.Ordinal))
                    && ScopedPrefixes.Any(p => path == p || path.StartsWith(p + "/", StringComparison.Ordinal)))
                {
                    context.Request.Path = "/w/" + Domain.Workspaces.WorkspaceId.DefaultValue + path;
                }
                await nextMw();
            });
            next(app);
        };
    }

    public new HttpClient CreateClient()
    {
        var client = base.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        return client;
    }

    public HttpClient CreateUnauthenticatedClient() => base.CreateClient();

    public HttpClient CreateClientAsOtherUser()
    {
        var client = base.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", OtherTestUserId);
        return client;
    }

    // A client whose scoped paths are NOT auto-prefixed (sets the opt-out header) — used to
    // assert that the rootless routes really are gone (404) after 23-G.
    public HttpClient CreateRawClient()
    {
        var client = base.CreateClient();
        client.DefaultRequestHeaders.Add("X-Test-User-Id", FakeCurrentUser.TestUserId);
        client.DefaultRequestHeaders.Add(NoPrefixHeader, "1");
        return client;
    }

    public const string OtherTestUserId = "other-user-456";
}
