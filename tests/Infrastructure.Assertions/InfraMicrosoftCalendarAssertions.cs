using Amazon.CDK;
using Amazon.CDK.Assertions;

// Phase 32-A: Microsoft 365 calendar env vars + conditional SSM grant.
public class InfraMicrosoftCalendarAssertions
{
    private static readonly Template _template = Build(new NoteTakerStackProps());
    private static readonly Template _microsoftTemplate = Build(new NoteTakerStackProps
    {
        CalendarProvider = "microsoft",
        MicrosoftRefreshTokenSsmPath = "/test/microsoft-refresh-token"
    });

    private static Dictionary<string, object> AssetContext() => new()
    {
        ["lambdaAssetPath"] = AppContext.BaseDirectory,
        ["projectorAssetPath"] = AppContext.BaseDirectory,
        ["transcribeCompletionAssetPath"] = AppContext.BaseDirectory
    };

    private static Template Build(NoteTakerStackProps props)
    {
        var app = new App(new AppProps { Context = AssetContext() });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", props));
    }

    private static void AssertEnvVarPresent(Template template, string name) =>
        template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    [name] = Match.AnyValue()
                })
            })
        }));

    [Fact]
    public void Lambda_HasMicrosoftClientIdEnvVar() => AssertEnvVarPresent(_template, "MS_CLIENT_ID");

    [Fact]
    public void Lambda_HasMicrosoftTenantIdEnvVar() => AssertEnvVarPresent(_template, "MS_TENANT_ID");

    [Fact]
    public void Lambda_HasCalendarProviderEnvVar() => AssertEnvVarPresent(_template, "CALENDAR_PROVIDER");

    [Fact]
    public void Lambda_HasMicrosoftRefreshTokenSsmPathEnvVar() =>
        AssertEnvVarPresent(_microsoftTemplate, "MICROSOFT_REFRESH_TOKEN_SSM_PATH");

    [Fact]
    public void Lambda_HasSsmGetParameterPermission_WhenMicrosoftTokenPathConfigured()
    {
        _microsoftTemplate.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "ssm:GetParameter",
                        ["Effect"] = "Allow",
                        ["Resource"] = Match.ObjectLike(new Dictionary<string, object>
                        {
                            ["Fn::Join"] = Match.ArrayWith(new object[]
                            {
                                Match.ArrayWith(new object[]
                                {
                                    Match.StringLikeRegexp(".*parameter/test/microsoft-refresh-token$")
                                })
                            })
                        })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasNoMicrosoftSsmPermission_WhenTokenPathNotConfigured()
    {
        // _template has no MicrosoftRefreshTokenSsmPath — the conditional grant must not fire for it.
        var thrown = Record.Exception(() =>
            _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
            {
                ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Statement"] = Match.ArrayWith(new object[]
                    {
                        Match.ObjectLike(new Dictionary<string, object>
                        {
                            ["Action"] = "ssm:GetParameter",
                            ["Resource"] = Match.ObjectLike(new Dictionary<string, object>
                            {
                                ["Fn::Join"] = Match.ArrayWith(new object[]
                                {
                                    Match.ArrayWith(new object[]
                                    {
                                        Match.StringLikeRegexp(".*parameter/test/microsoft-refresh-token$")
                                    })
                                })
                            })
                        })
                    })
                })
            })));
        Assert.NotNull(thrown);
    }
}
