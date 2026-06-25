namespace Api.Mcp.OAuth;

// A pending authorization captured at /oauth/authorize, keyed by OUR google_state and consumed at
// /oauth/google/callback. Holds Claude's original request so the callback can resume it, plus our own
// upstream-Google PKCE verifier + the workspace the connector is for.
public sealed record McpPendingAuth(
    string GoogleState,
    string GoogleCodeVerifier,
    string ClientId,
    string RedirectUri,
    string CodeChallenge,
    string State,
    string Resource,
    string WorkspaceId);

// OUR authorization code, issued at the Google callback and consumed once at /oauth/token. Binds the
// code to the client, redirect, PKCE challenge and resolved identity so /token can verify all of them.
public sealed record McpAuthCode(
    string Code,
    string ClientId,
    string RedirectUri,
    string CodeChallenge,
    string Resource,
    string WorkspaceId,
    string UserId);
