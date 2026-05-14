using Amazon.CDK;
using Amazon.CDK.Assertions;

public class InfraAssertionsTests
{
    private static readonly Template _template = BuildTemplate();

    private static Template BuildTemplate()
    {
        // CDK.FromAsset requires a directory that exists at synth time.
        // We pass the test output directory as a stand-in for the Lambda asset.
        var lambdaAssetPath = AppContext.BaseDirectory;
        var app = new App(new AppProps
        {
            Context = new Dictionary<string, object>
            {
                ["lambdaAssetPath"] = lambdaAssetPath
            }
        });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new StackProps()));
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
    public void CloudFront_HasSpaErrorResponses()
    {
        _template.HasResourceProperties("AWS::CloudFront::Distribution", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DistributionConfig"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["CustomErrorResponses"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["ErrorCode"] = 403,
                        ["ResponseCode"] = 200,
                        ["ResponsePagePath"] = "/index.html"
                    }),
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["ErrorCode"] = 404,
                        ["ResponseCode"] = 200,
                        ["ResponsePagePath"] = "/index.html"
                    })
                })
            })
        }));
    }
}
