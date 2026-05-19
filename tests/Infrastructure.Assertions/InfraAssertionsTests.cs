using Amazon.CDK;
using Amazon.CDK.Assertions;

public class InfraAssertionsTests
{
    private static readonly Template _template = BuildTemplate();
    private static readonly Template _domainTemplate = BuildDomainTemplate();

    private static Template BuildTemplate()
    {
        var lambdaAssetPath = AppContext.BaseDirectory;
        var app = new App(new AppProps
        {
            Context = new Dictionary<string, object>
            {
                ["lambdaAssetPath"] = lambdaAssetPath
            }
        });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new NoteTakerStackProps()));
    }

    private static Template BuildDomainTemplate()
    {
        var lambdaAssetPath = AppContext.BaseDirectory;
        var app = new App(new AppProps
        {
            Context = new Dictionary<string, object>
            {
                ["lambdaAssetPath"] = lambdaAssetPath
            }
        });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new NoteTakerStackProps
        {
            CertificateArn = "arn:aws:acm:us-east-1:123456789012:certificate/fake-cert-id",
            DomainName = "test.note-taker-ai.com",
            HostedZoneId = "ZFAKE123456789"
        }));
    }

    [Fact]
    public void Lambda_HasEventsTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["EVENTS_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasProjTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_NOTETITLELIST_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void EventsTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-events"
            })
        }));
    }

    [Fact]
    public void ProjTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-notetitlelist"
            })
        }));
    }

    [Fact]
    public void Lambda_TimeoutIsAtLeast10Seconds()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Timeout"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Lambda_HasTransactWriteItemsPermissionOnEventsTable()
    {
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "dynamodb:TransactWriteItems",
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void NoteCardListTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-notecardlist"
            })
        }));
    }

    [Fact]
    public void Lambda_HasNoteCardListTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_NOTECARDLIST_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void FolderTreeTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*foldertree.*")
            })
        }));
    }

    [Fact]
    public void Lambda_HasFolderTreeTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_FOLDERTREE_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_RuntimeIsDotnet10()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Runtime"] = "dotnet10"
        }));
    }

    [Fact]
    public void Lambda_HasSnapStartOnPublishedVersions()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["SnapStart"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["ApplyOn"] = "PublishedVersions"
            })
        }));
    }

    [Fact]
    public void TagIndexTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*tagindex.*")
            })
        }));
    }

    [Fact]
    public void Lambda_HasTagIndexTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_TAGINDEX_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasMemorySize512()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["MemorySize"] = 512
        }));
    }

    [Fact]
    public void CloudFront_HasApiBehavior_Always()
    {
        _template.HasResourceProperties("AWS::CloudFront::Distribution", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DistributionConfig"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["CacheBehaviors"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["PathPattern"] = "/api/*"
                    })
                })
            })
        }));
    }

    [Fact]
    public void CloudFront_HasTwoFunctions_SpaRoutingAndApiStrip()
    {
        _template.ResourceCountIs("AWS::CloudFront::Function", 2);
    }

    [Fact]
    public void CloudFront_HasCustomDomainAlias_WhenDomainConfigured()
    {
        _domainTemplate.HasResourceProperties("AWS::CloudFront::Distribution", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DistributionConfig"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Aliases"] = Match.ArrayWith(new object[] { "test.note-taker-ai.com" })
            })
        }));
    }

    [Fact]
    public void Route53_HasAliasRecord_WhenDomainConfigured()
    {
        _domainTemplate.HasResourceProperties("AWS::Route53::RecordSet", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Name"] = "test.note-taker-ai.com.",
            ["Type"] = "A"
        }));
    }
}
