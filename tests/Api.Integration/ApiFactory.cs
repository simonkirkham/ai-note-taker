using EventStore;
using EventStore.Projections;
using Api.Auth;
using Api.HealthChecks;
using Api.Services;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
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
        Environment.SetEnvironmentVariable("ALLOWED_USER_SUBS", "test-user-123,other-user-456");
        Environment.SetEnvironmentVariable("GOOGLE_CLIENT_ID", "test-client-id");
        Environment.SetEnvironmentVariable("GOOGLE_CLIENT_SECRET", "test-client-secret");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IGoogleCalendarClient>();
            services.AddSingleton<FakeGoogleCalendarClient>();
            services.AddSingleton<IGoogleCalendarClient>(sp => sp.GetRequiredService<FakeGoogleCalendarClient>());
            services.RemoveAll<IGoogleOAuthClient>();
            services.AddSingleton<FakeGoogleOAuthClient>();
            services.AddSingleton<IGoogleOAuthClient>(sp => sp.GetRequiredService<FakeGoogleOAuthClient>());
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
            services.RemoveAll<IDynamoHealthCheck>();
            services.AddSingleton<IEventStore, InMemoryEventStore>();
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
            services.AddSingleton<Api.Services.INoteImageStore, FakeNoteImageStore>();
        });
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

    public const string OtherTestUserId = "other-user-456";
}
