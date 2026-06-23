namespace Api.Integration;

// Calendar tests toggle the process-wide CALENDAR_PROVIDER / STUB_CALENDAR_JSON / MS_CLIENT_ID /
// MS_TENANT_ID env vars (provider selection + the Microsoft client's config). Group them in a
// non-parallel collection so one class mutating those vars can't leak into another class that is
// concurrently constructing a calendar client (e.g. StubCalendarClient reading STUB_CALENDAR_JSON).
[CollectionDefinition("CalendarEnv", DisableParallelization = true)]
public sealed class CalendarEnvCollection;
