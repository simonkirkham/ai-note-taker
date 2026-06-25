using Amazon.CDK;
using Amazon.CDK.Assertions;

// Microsoft 365 calendar env vars. 34-D2 retired CALENDAR_PROVIDER + the Microsoft SSM grant/env —
// Outlook is fully in-app. MS_CLIENT_ID/MS_TENANT_ID remain (the in-app OAuth + Graph token exchange).
public class InfraMicrosoftCalendarAssertions
{
    private static readonly Template _template = Build(new NoteTakerStackProps());

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

    private static void AssertEnvVarAbsent(Template template, string name)
    {
        var thrown = Record.Exception(() => AssertEnvVarPresent(template, name));
        Assert.NotNull(thrown);
    }

    [Fact]
    public void Lambda_HasMicrosoftClientIdEnvVar() => AssertEnvVarPresent(_template, "MS_CLIENT_ID");

    [Fact]
    public void Lambda_HasMicrosoftTenantIdEnvVar() => AssertEnvVarPresent(_template, "MS_TENANT_ID");

    [Fact]
    public void Lambda_HasNoCalendarProviderEnvVar() => AssertEnvVarAbsent(_template, "CALENDAR_PROVIDER");

    [Fact]
    public void Lambda_HasNoMicrosoftRefreshTokenSsmPathEnvVar() => AssertEnvVarAbsent(_template, "MICROSOFT_REFRESH_TOKEN_SSM_PATH");

    [Fact]
    public void Lambda_HasNoSsmGetParameterPermission()
    {
        // 34-D2: no calendar SSM grant remains on any function.
        var thrown = Record.Exception(() =>
            _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
            {
                ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Statement"] = Match.ArrayWith(new object[]
                    {
                        Match.ObjectLike(new Dictionary<string, object>
                        {
                            ["Action"] = "ssm:GetParameter"
                        })
                    })
                })
            })));
        Assert.NotNull(thrown);
    }
}
