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
            ZoneName = DomainHelpers.ApexDomain(domainName)
        });

        Certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = domainName,
            Validation = CertificateValidation.FromDns(hostedZone)
        });
    }
}
