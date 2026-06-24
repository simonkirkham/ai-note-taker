using Amazon.CDK;

public sealed class NoteTakerStackProps : StackProps
{
    public string? CertificateArn { get; init; }
    public string? DomainName { get; init; }
    public string? HostedZoneId { get; init; }
    public string? GoogleClientId { get; init; }
    public string? GoogleClientSecret { get; init; }
    public string? AllowedUserSubs { get; init; }
    public string? BedrockModelId { get; init; }
    public string? CalendarProvider { get; init; }
    public string? MicrosoftClientId { get; init; }
    public string? MicrosoftTenantId { get; init; }
    public string? MicrosoftRefreshTokenSsmPath { get; init; }
}
