namespace EventStore.Integration;

internal static class DynamoDbLocalImage
{
    // AWS's own ECR Public copy, not the Docker Hub original. Identical artefact — the
    // 1.21.0 manifest digests match Docker Hub's byte for byte (amd64 sha256:f023844…,
    // arm64 sha256:ceffe76…) — but Docker Hub's anonymous pull limit is what a GitHub
    // runner (shared egress IPs) keeps tripping, and a throttled pull that never lands is
    // reported by Testcontainers as "No such image" at fixture start (TI-71).
    public const string DefaultReference = "public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:1.21.0";

    // CI overrides this so its pre-pull step and the tests are guaranteed to name the same
    // image. That pre-pull is load-bearing, not an optimisation: every test class here owns
    // its own container, xUnit starts those classes in parallel, and each one issues its own
    // pull. ECR Public allows one anonymous pull per second per IP, so the concurrent burst
    // is throttled even though the registry is healthy — which is exactly how a green suite
    // reports 5 failures that never ran. Pulling once, sequentially, before the suite starts
    // leaves Testcontainers nothing to fetch (its default pull policy is "missing only").
    public static string Reference =>
        Environment.GetEnvironmentVariable("DYNAMODB_LOCAL_IMAGE") is { Length: > 0 } configured
            ? configured
            : DefaultReference;
}
