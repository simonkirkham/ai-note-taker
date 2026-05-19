using Amazon.CDK;

public sealed class NoteTakerStackProps : StackProps
{
    public string? CertificateArn { get; init; }
    public string? DomainName { get; init; }
    public string? HostedZoneId { get; init; }
    public string? GoogleClientId { get; init; }
    public string? GoogleClientSecret { get; init; }
    public string? AllowedUserSubs { get; init; }
}
