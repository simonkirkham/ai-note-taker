# Phase 9-B learnings — Google Calendar API pass-through

## 1. Google Calendar SDK returns null Items, not empty list

`Events.List(...).ExecuteAsync()` returns an `Events` object where `Items` is `null` (not `[]`) when there are no events in the time window. Calling LINQ methods directly on it throws `NullReferenceException`. Always null-coalesce: `(events.Items ?? []).Where(...)`.

**Done:** Applied in `GoogleCalendarClient.cs`. Added to mental model for any future Google SDK collections.

## 2. All-day events need explicit UTC offset; `DateTimeOffset.Parse` uses process local

For all-day events the SDK sets `e.Start.DateTimeDateTimeOffset = null` and `e.Start.Date = "YYYY-MM-DD"`. `DateTimeOffset.Parse("2026-05-20")` parses midnight in the **process** local timezone (UTC on Lambda), not the caller's timezone. Fix: `new DateTimeOffset(DateTime.Parse(e.Start.Date!), utcOffset)` where `utcOffset = tz.GetUtcOffset(todayLocal)`.

**Done:** Fixed. A user in `Europe/London (BST, UTC+1)` now gets midnight London, not midnight UTC.

## 3. Google.Apis SDK types implement IDisposable — wrap in `using`

`GoogleAuthorizationCodeFlow` and `CalendarService` (inherits `BaseClientService`) both implement `IDisposable` and own `HttpClient` instances. Not disposing them leaks connections on every warm Lambda invocation. Wrap in `using var`.

**Done:** Both wrapped. The disposal order is correct: `flow` is created first and used only to construct `credential`, which is held by `service`. `service` is disposed first.

## 4. Handler owns sort; service interface returns in natural order

The Google Calendar API's `orderBy=startTime` request option sorts server-side, but the `FakeGoogleCalendarClient` doesn't sort. Putting `OrderBy(e => e.StartTime)` in the handler makes ordering verifiable in integration tests regardless of the underlying source. The production client omits the server-side `OrderBy` to keep the service contract simple (sort is not part of the interface contract).

**Done:** Sort is in `CalendarHandlers.GetTodaysMeetings`.

## 5. Invalid IANA timezone → 400, not calendar_unavailable

`TimeZoneInfo.FindSystemTimeZoneById` throws `TimeZoneNotFoundException` for bad input. Letting this bubble through the `catch (Exception)` in the service produces `{ "error": "calendar_unavailable" }` with HTTP 200 — misleading to the client (implies Google is down, not that the request was malformed). Validate the timezone in the handler before calling the service; return 400 `{ "error": "invalid_timezone" }`.

**Done:** Handler catches `TimeZoneNotFoundException` and returns `BadRequest`.

## 6. Static token cache comment is load-bearing

Caching the SSM refresh token in a `static` field deliberately trades revocation responsiveness for Lambda SnapStart compatibility. Without an explanatory comment the next engineer either adds unnecessary TTL logic or, worse, breaks the SnapStart benefit. Comment documents: *cached for Lambda process lifetime; revocation requires redeploy or instance recycle; CMK SSM parameters also need `kms:Decrypt` on the execution role.*

**Done:** Comment present in `GoogleCalendarClient.cs` lines 22–25.
