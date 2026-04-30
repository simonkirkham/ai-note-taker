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
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IEventStore>();
            services.RemoveAll<INoteTitleListStore>();
            services.AddSingleton<IEventStore, InMemoryEventStore>();
            services.AddSingleton<INoteTitleListStore, InMemoryNoteTitleListStore>();
        });
    }
}
