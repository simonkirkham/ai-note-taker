using Api;
using EventStore;
using EventStore.Projections;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace ApiIntegration;

public sealed class ApiFactory : WebApplicationFactory<Program>
{
    static ApiFactory()
    {
        Environment.SetEnvironmentVariable("EVENTS_TABLE_NAME", "test-events");
        Environment.SetEnvironmentVariable("PROJ_NOTETITLELIST_TABLE_NAME", "test-proj");
        Environment.SetEnvironmentVariable("PROJ_NOTEDETAIL_TABLE_NAME", "test-proj-notedetail");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEventStore>();
            services.RemoveAll<INoteTitleListStore>();
            services.RemoveAll<INoteDetailStore>();
            services.RemoveAll<IDynamoHealthCheck>();
            services.AddSingleton<IEventStore, InMemoryEventStore>();
            services.AddSingleton<INoteTitleListStore, InMemoryNoteTitleListStore>();
            services.AddSingleton<INoteDetailStore, InMemoryNoteDetailStore>();
            services.AddSingleton<IDynamoHealthCheck, AlwaysHealthyDynamoCheck>();
        });
    }
}
