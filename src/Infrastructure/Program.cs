using Amazon.CDK;

var app = new App();

var domainName = System.Environment.GetEnvironmentVariable("DOMAIN_NAME");
var hostedZoneId = System.Environment.GetEnvironmentVariable("HOSTED_ZONE_ID");
var googleClientId = System.Environment.GetEnvironmentVariable("GOOGLE_CLIENT_ID");
var googleClientSecret = System.Environment.GetEnvironmentVariable("GOOGLE_CLIENT_SECRET");
var allowedUserSubs = System.Environment.GetEnvironmentVariable("ALLOWED_USER_SUBS");
var bedrockModelId = System.Environment.GetEnvironmentVariable("BEDROCK_MODEL_ID");
var calendarProvider = System.Environment.GetEnvironmentVariable("CALENDAR_PROVIDER");
var microsoftClientId = System.Environment.GetEnvironmentVariable("MS_CLIENT_ID");
var microsoftTenantId = System.Environment.GetEnvironmentVariable("MS_TENANT_ID");
var microsoftRefreshTokenSsmPath = System.Environment.GetEnvironmentVariable("MICROSOFT_REFRESH_TOKEN_SSM_PATH");

string? certificateArn = null;

if (!string.IsNullOrEmpty(domainName) && !string.IsNullOrEmpty(hostedZoneId))
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
}

new NoteTakerStack(app, "NoteTakerStack", new NoteTakerStackProps
{
    Env = new Amazon.CDK.Environment
    {
        Account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT"),
        Region = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_REGION")
    },
    CrossRegionReferences = !string.IsNullOrEmpty(domainName),
    CertificateArn = certificateArn,
    DomainName = domainName,
    HostedZoneId = hostedZoneId,
    GoogleClientId = googleClientId,
    GoogleClientSecret = googleClientSecret,
    AllowedUserSubs = allowedUserSubs,
    BedrockModelId = bedrockModelId,
    CalendarProvider = calendarProvider,
    MicrosoftClientId = microsoftClientId,
    MicrosoftTenantId = microsoftTenantId,
    MicrosoftRefreshTokenSsmPath = microsoftRefreshTokenSsmPath
});

app.Synth();
