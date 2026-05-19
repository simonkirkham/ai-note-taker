using Amazon.CDK;

var app = new App();

var domainName = System.Environment.GetEnvironmentVariable("DOMAIN_NAME");
var hostedZoneId = System.Environment.GetEnvironmentVariable("HOSTED_ZONE_ID");
var certArnEnv = System.Environment.GetEnvironmentVariable("CERTIFICATE_ARN");

// Two cert paths:
//   CERTIFICATE_ARN set  → import a pre-existing cert (e.g. Test env where Route 53 is in
//                          a different account — cert created manually, no CertificateStack)
//   DOMAIN_NAME + HOSTED_ZONE_ID set → create cert via CertificateStack in us-east-1
//                          (Production env where Route 53 is in the same account)
string? certificateArn = null;
var usingCertStack = false;

if (!string.IsNullOrEmpty(certArnEnv))
{
    certificateArn = certArnEnv;
}
else if (!string.IsNullOrEmpty(domainName) && !string.IsNullOrEmpty(hostedZoneId))
{
    var certStack = new CertificateStack(app, "NoteTakerCertStack", domainName, hostedZoneId, new StackProps
    {
        Env = new Amazon.CDK.Environment
        {
            Account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT"),
            Region = "us-east-1"
        },
        CrossRegionReferences = true
    });
    certificateArn = certStack.Certificate.CertificateArn;
    usingCertStack = true;
}

new NoteTakerStack(app, "NoteTakerStack", new NoteTakerStackProps
{
    Env = new Amazon.CDK.Environment
    {
        Account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT"),
        Region = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_REGION")
    },
    CrossRegionReferences = usingCertStack,
    CertificateArn = certificateArn,
    DomainName = domainName,
    HostedZoneId = hostedZoneId
});

app.Synth();
