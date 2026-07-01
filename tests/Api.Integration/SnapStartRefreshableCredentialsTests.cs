using Amazon.Runtime;
using Api.Aws;

namespace Api.Integration;

// BUG-43: the swap mechanism the SnapStart after-restore hook relies on. End-to-end verification (a
// stale snapshot token vs. the live container endpoint) is only possible against a real restore, so
// this guards the piece that IS testable: the holder delegates to its seeded inner, and the restore
// swap replaces it with the self-refreshing container-credentials provider.
public sealed class SnapStartRefreshableCredentialsTests
{
    [Fact]
    public void DelegatesToSeededInner_UntilSwappedToContainerCredentials()
    {
        // GenericContainerCredentials' ctor requires a container endpoint env var (present under a real
        // SnapStart restore). Set the relative-URI form so the swap can construct it; snapshot/restore
        // the process-wide var. We never fetch (no live endpoint) — only assert the swap took effect.
        const string endpointVar = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI";
        var original = Environment.GetEnvironmentVariable(endpointVar);
        try
        {
            Environment.SetEnvironmentVariable(endpointVar, "/creds");

            var seed = new BasicAWSCredentials("seed-ak", "seed-sk");
            var creds = new SnapStartRefreshableCredentials(seed);

            Assert.Same(seed, creds.Inner);
            Assert.Equal("seed-ak", creds.GetCredentials().AccessKey);   // delegates to the seed

            creds.UseContainerCredentials();                             // the after-restore swap

            Assert.IsType<GenericContainerCredentials>(creds.Inner);     // now reads the container endpoint
        }
        finally
        {
            Environment.SetEnvironmentVariable(endpointVar, original);
        }
    }

    [Fact]
    public void NullInner_Throws()
    {
        Assert.Throws<ArgumentNullException>(() => new SnapStartRefreshableCredentials(null!));
    }
}
