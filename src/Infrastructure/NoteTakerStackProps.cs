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
    public string? MicrosoftClientId { get; init; }
    public string? MicrosoftTenantId { get; init; }
    // 35-E MCP OAuth broker. Issuer = the execute-api host (exact, no trailing slash); differs per
    // environment, so it is config not a code constant. Client id = the single pre-registered Claude
    // connector client. Both default to "" when unset (GitHub passes unset optional secrets as "").
    public string? McpOAuthIssuer { get; init; }
    public string? McpOAuthClientId { get; init; }
}
