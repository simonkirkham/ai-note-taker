using Amazon.CDK;

public sealed class NoteTakerStackProps : StackProps
{
    public string? CertificateArn { get; init; }
    public string? DomainName { get; init; }
    public string? HostedZoneId { get; init; }
}
