namespace Api.Observability;

public interface IDomainMetrics
{
    void CommandHandled(string commandType, string aggregate);

    void CommandFailed(string commandType, string exceptionType);

    void EventsAppended(string aggregate, int count);

    void ConcurrencyConflict(string aggregate);

    void SearchPerformed(int resultCount, int notesScanned, double latencyMs);

    void ProjectionRebuildDuration(double milliseconds);

    void ProjectionRebuildFault();

    // Analysis (Bedrock) timing + failures. AnalysisCompleted carries the inference
    // latency (drives the p50/p99 widget); AnalysisFailed is the alarmable count — the
    // failing note's id stays in the structured log, never a metric dimension.
    void AnalysisCompleted(double milliseconds);

    void AnalysisFailed();

    // Auth visibility (Phase 30 obs table). No token material or PII ever enters a metric —
    // only outcome counts. SignInCompleted fires on a successful /auth/token exchange;
    // consentIssued=true means Google returned a refresh_token, i.e. the user was shown the
    // full consent screen and a fresh grant was issued (the "forced to re-authorise" signal).
    // A silent returning sign-in has consentIssued=false.
    void SignInCompleted(bool consentIssued);

    // Outcome of POST /auth/refresh — the silent session-refresh path. "completed" (session slid
    // forward), "no_cookie" (rt cookie absent → the client is forced to sign in again), "rejected"
    // (Google revoked/expired the token → forced re-consent), or "error" (a Google outage: 502/504).
    // A rising no_cookie/rejected/error rate is the measurable form of "asked to log in a lot".
    void SessionRefresh(string outcome);

    // The two Phase 30 obs-table durability signals. RefreshTokenStoreWriteFault: the server-side
    // durable copy failed to persist (the user silently loses long-lived sign-in) — alarm on sustained
    // >0. RefreshTokenRevoked: Google rejected a stored token and it was evicted (a genuine session
    // death). Both dimensionless so an alarm can target them directly; the sub stays in the log only.
    void RefreshTokenStoreWriteFault();

    void RefreshTokenRevoked();
}
