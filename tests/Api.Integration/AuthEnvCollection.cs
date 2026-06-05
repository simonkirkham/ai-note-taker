namespace Api.Integration;

// Auth tests toggle the process-wide GOOGLE_CLIENT_ID/SECRET env vars (the 503 guard test).
// Group them in a non-parallel collection so that mutation can't leak into a concurrent
// /auth/refresh or /auth/token test in another class.
[CollectionDefinition("AuthEnv", DisableParallelization = true)]
public sealed class AuthEnvCollection;
