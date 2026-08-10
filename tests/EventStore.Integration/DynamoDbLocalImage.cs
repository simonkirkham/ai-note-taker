namespace EventStore.Integration;

internal static class DynamoDbLocalImage
{
    // AWS's own ECR Public copy, not the Docker Hub original. Identical artefact — the
    // 1.21.0 manifest digests match Docker Hub's byte for byte (amd64 sha256:f023844…,
    // arm64 sha256:ceffe76…) — but ECR Public serves anonymous pulls without Docker Hub's
    // rate limit. From a GitHub runner (shared egress IPs) that limit surfaced as a pull
    // that never landed, which Testcontainers reports as "No such image", failing all 26
    // fixture-backed tests on a diff that touched no C# at all (TI-71).
    public const string Reference = "public.ecr.aws/aws-dynamodb-local/aws-dynamodb-local:1.21.0";
}
