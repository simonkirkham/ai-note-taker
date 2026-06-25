using Api.Services;

namespace Api.Integration;

// Test factory that always returns the same (fake) client regardless of workspace — lets the
// existing calendar handler tests stage events on one FakeCalendarClient. Provider-resolution
// behaviour is tested directly against the real CalendarClientFactory in CalendarClientFactoryTests.
public sealed class FixedCalendarClientFactory(ICalendarClient client) : ICalendarClientFactory
{
    public Task<ICalendarClient> ForAsync(string workspaceId, CancellationToken ct = default) =>
        Task.FromResult(client);
}
