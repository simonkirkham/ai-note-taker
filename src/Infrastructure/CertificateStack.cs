using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.Route53;
using Constructs;

public sealed class CertificateStack : Stack
{
    public ICertificate Certificate { get; }

    public CertificateStack(Construct scope, string id, string domainName, string hostedZoneId, IStackProps props)
        : base(scope, id, props)
    {
        var hostedZone = HostedZone.FromHostedZoneAttributes(this, "HostedZone", new HostedZoneAttributes
        {
            HostedZoneId = hostedZoneId,
            ZoneName = ApexDomain(domainName)
        });

        Certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = domainName,
            Validation = CertificateValidation.FromDns(hostedZone)
        });
    }

    // "test.note-taker-ai.com" -> "note-taker-ai.com"
    // "note-taker-ai.com" -> "note-taker-ai.com"
    private static string ApexDomain(string domain)
    {
        var parts = domain.Split('.');
        return parts.Length > 2 ? string.Join('.', parts[^2..]) : domain;
    }
}
