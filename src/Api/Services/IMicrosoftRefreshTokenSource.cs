namespace Api.Services;

// Loads the Microsoft (Entra) refresh token used to mint Graph access tokens. Split out from
// MicrosoftCalendarClient so the client's invalid_grant heal path (reload + retry) is unit-testable
// with a fake source. The only implementation since 34-D2 is MicrosoftCalendarTokenSource (the
// per-(user,workspace) in-app token); the legacy SSM source was removed with the SSM fallback.
public interface IMicrosoftRefreshTokenSource
{
    // Returns the in-app refresh token for the current user + workspace, or null when none is
    // connected. forceReload is retained for interface compatibility (the stored token is read fresh
    // each call); after Entra invalid_grant the client retries with it, which re-reads the same
    // stored token → the client gives up and the UI offers "Reconnect".
    Task<string?> LoadAsync(bool forceReload);
}
