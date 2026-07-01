using Amazon.Runtime;

namespace Api.Aws;

// BUG-43: an AWSCredentials holder whose inner provider can be swapped after a Lambda SnapStart
// restore. The service client binds ONE credentials object at construction and asks it for
// credentials per request, so replacing the inner provider takes effect immediately — without
// recreating the (DI-singleton) client, which V4 does not support.
//
// Why it's needed: SnapStart captures the snapshot at end-of-init. The V4 credential chain resolves
// the AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN env-var session token first, and that token is frozen in
// the snapshot → invalid after restore ("The security token included in the request is invalid",
// cold_start:true). AWS steers SnapStart at the *container* credential endpoint
// (AWS_CONTAINER_CREDENTIALS_FULL_URI), which serves fresh credentials on restore. So on restore we
// swap the inner provider to GenericContainerCredentials (self-refreshing, reads that endpoint); the
// first post-restore request then signs with fresh credentials. Before restore the inner is the
// default chain (fine — that window is just init/priming, pre-snapshot).
public sealed class SnapStartRefreshableCredentials(AWSCredentials inner) : AWSCredentials
{
    private volatile AWSCredentials _inner = inner ?? throw new ArgumentNullException(nameof(inner));

    // Current inner provider — exposed for the swap assertion and observability.
    public AWSCredentials Inner => _inner;

    // Called from the RegisterAfterRestore hook. A NEW GenericContainerCredentials re-reads the
    // container endpoint, so the stale snapshot token is discarded and fresh credentials are fetched.
    public void UseContainerCredentials() => _inner = new GenericContainerCredentials();

    public override ImmutableCredentials GetCredentials() => _inner.GetCredentials();

    public override System.Threading.Tasks.Task<ImmutableCredentials> GetCredentialsAsync() =>
        _inner.GetCredentialsAsync();
}
