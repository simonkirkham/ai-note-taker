using Amazon.CDK;
using Amazon.CDK.Assertions;

public class InfraAssertionsTests
{
    private static readonly Template _template = BuildTemplate();
    private static readonly Template _domainTemplate = BuildDomainTemplate();
    private static readonly Template _calendarTemplate = BuildCalendarTemplate();

    // Both Lambda assets point at a real directory (the test bin dir) so synth never
    // needs an actual `dotnet publish` — the projector asset uses the same context-key
    // indirection as the API asset.
    private static Dictionary<string, object> AssetContext() => new()
    {
        ["lambdaAssetPath"] = AppContext.BaseDirectory,
        ["projectorAssetPath"] = AppContext.BaseDirectory,
        ["transcribeCompletionAssetPath"] = AppContext.BaseDirectory
    };

    private static Template BuildTemplate()
    {
        var app = new App(new AppProps { Context = AssetContext() });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new NoteTakerStackProps()));
    }

    private static Template BuildDomainTemplate()
    {
        var app = new App(new AppProps { Context = AssetContext() });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new NoteTakerStackProps
        {
            CertificateArn = "arn:aws:acm:us-east-1:123456789012:certificate/fake-cert-id",
            DomainName = "test.note-taker-ai.com",
            HostedZoneId = "ZFAKE123456789"
        }));
    }

    private static Template BuildCalendarTemplate()
    {
        var app = new App(new AppProps { Context = AssetContext() });
        return Template.FromStack(new NoteTakerStack(app, "TestStack", new NoteTakerStackProps
        {
            GoogleRefreshTokenSsmPath = "/test/google-refresh-token"
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
    public void TagFeedbackTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*tagfeedback.*")
            })
        }));
    }

    [Fact]
    public void TagFeedbackTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*tagfeedback.*")
            })
        }));
    }

    [Fact]
    public void Lambda_HasTagFeedbackTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_TAGFEEDBACK_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void ActionFeedbackTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*actionfeedback.*")
            })
        }));
    }

    [Fact]
    public void ActionFeedbackTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = Match.StringLikeRegexp(".*actionfeedback.*")
            })
        }));
    }

    [Fact]
    public void Lambda_HasActionFeedbackTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_ACTIONFEEDBACK_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void ApiFunction_HasMemorySize512()
    {
        // TI-36: the API Lambda runs at 512 MB (raised from 256 for cold-start vCPU).
        // Pin the Handler so this matches the API function specifically, not the
        // Projector function which also runs at 512.
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "Api",
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

    [Fact]
    public void Lambda_HasGoogleClientIdEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["GOOGLE_CLIENT_ID"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasGoogleClientSecretEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["GOOGLE_CLIENT_SECRET"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasAllowedUserSubsEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["ALLOWED_USER_SUBS"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasGoogleRefreshTokenSsmPathEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["GOOGLE_REFRESH_TOKEN_SSM_PATH"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasCalendarLinkIndexTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_CALENDARLINKINDEX_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void CalendarLinkIndex_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-calendarlinkindex"
            })
        }));
    }

    [Fact]
    public void CalendarLinkIndex_HasPointInTimeRecovery()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-calendarlinkindex",
                ["PointInTimeRecoverySpecification"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PointInTimeRecoveryEnabled"] = true
                })
            })
        }));
    }

    [Fact]
    public void CalendarLinkIndex_HasRecurringSeriesIdGsi()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-calendarlinkindex",
                ["GlobalSecondaryIndexes"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["IndexName"] = "RecurringSeriesId-index"
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasSsmGetParameterPermission_WhenRefreshTokenPathConfigured()
    {
        // Resource is a Fn::Join intrinsic; assert the specific parameter path is embedded in it
        _calendarTemplate.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
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
                                    Match.StringLikeRegexp(".*parameter/test/google-refresh-token$")
                                })
                            })
                        })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasNoSsmPermission_WhenRefreshTokenPathNotConfigured()
    {
        // _template has no GoogleRefreshTokenSsmPath — the conditional grant must not fire
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

    [Fact]
    public void Lambda_HasBedrockModelIdEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["BEDROCK_MODEL_ID"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasTranscribeRoleArnEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["TRANSCRIBE_ROLE_ARN"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void TranscribeBrowserRole_ExistsWithStartStreamTranscriptionPermission()
    {
        // Both HTTP/2 and WebSocket variants are required; CDK renders multiple actions as an array.
        _template.HasResourceProperties("AWS::IAM::Role", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Policies"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Statement"] = Match.ArrayWith(new object[]
                        {
                            Match.ObjectLike(new Dictionary<string, object>
                            {
                                ["Action"] = Match.ArrayWith(new object[]
                                {
                                    "transcribe:StartStreamTranscription",
                                    "transcribe:StartStreamTranscriptionWebSocket"
                                }),
                                ["Effect"] = "Allow"
                            })
                        })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasStsAssumeRolePermissionOnTranscribeRole()
    {
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "sts:AssumeRole",
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void TranscribeBrowserRole_TrustPolicyAllowsOnlyLambdaExecRole()
    {
        // Trust policy must use a scoped AWS principal (the Lambda exec role ARN),
        // not a wildcard "*". Asserting Principal.AWS exists proves it is not "*".
        _template.HasResourceProperties("AWS::IAM::Role", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AssumeRolePolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "sts:AssumeRole",
                        ["Effect"] = "Allow",
                        ["Principal"] = Match.ObjectLike(new Dictionary<string, object>
                        {
                            ["AWS"] = Match.AnyValue()
                        })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasBedrockInvokeModelPermission()
    {
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "bedrock:InvokeModel",
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void CommandFunction_HasStartTranscriptionJobPermission()
    {
        // 33-B1: the diarize endpoint starts a batch job. No DataAccessRole is passed, so
        // Transcribe acts as the Command function's identity (which already holds recordings/* RW).
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "transcribe:StartTranscriptionJob",
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void TranscribeCompletionFunction_Exists()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "TranscribeCompletion::TranscribeCompletion.TranscribeCompletionFunction::Handle"
        }));
    }

    [Fact]
    public void TranscribeCompletionFunction_HasGetTranscriptionJobPermission()
    {
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = "transcribe:GetTranscriptionJob",
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void TranscribeJobStateChangeRule_RoutesTerminalStatesToCompletionLambda()
    {
        _template.HasResourceProperties("AWS::Events::Rule", Match.ObjectLike(new Dictionary<string, object>
        {
            ["EventPattern"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["source"] = new[] { "aws.transcribe" },
                ["detail-type"] = new[] { "Transcribe Job State Change" },
                ["detail"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["TranscriptionJobStatus"] = new[] { "COMPLETED", "FAILED" }
                })
            })
        }));
    }

    [Fact]
    public void Lambda_UsesDefaultBedrockModelId_WhenNotConfigured()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["BEDROCK_MODEL_ID"] = "amazon.nova-lite-v1:0"
                })
            })
        }));
    }

    [Fact]
    public void ApiFunction_HasLogGroupWithOneMonthRetention()
    {
        _template.HasResourceProperties("AWS::Logs::LogGroup", Match.ObjectLike(new Dictionary<string, object>
        {
            ["RetentionInDays"] = 30
        }));
    }

    [Fact]
    public void Lambda_HasActiveXRayTracing()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["TracingConfig"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Mode"] = "Active"
            })
        }));
    }

    [Fact]
    public void Lambda_HasXRayWritePermissions()
    {
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = Match.ArrayWith(new object[]
                        {
                            "xray:PutTraceSegments",
                            "xray:PutTelemetryRecords"
                        }),
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasXRayContextMissingEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR"
                })
            })
        }));
    }

    [Fact]
    public void OpsDashboard_ExistsNamedNotetakerOps()
    {
        _template.ResourceCountIs("AWS::CloudWatch::Dashboard", 1);
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardName"] = "notetaker-ops"
        }));
    }

    [Fact]
    public void OpsDashboard_IncludesErrorsWidgetAndDomainMetrics()
    {
        // DashboardBody is an Fn::Join of literal JSON fragments and tokens; assert
        // the literal fragments carry the errors widget title and the domain namespace.
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*All errors.*") })
                })
            })
        }));
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*NoteTaker/Domain.*") })
                })
            })
        }));
    }

    [Theory]
    [InlineData("CommandHandled")]
    [InlineData("ConcurrencyConflict")]
    public void OpsDashboard_DomainMetricUsesSumSearch(string metricName)
    {
        // Guards the fix for the dimensioned-metric bug: the widget must query the
        // domain metric via SUM(SEARCH(...)) (matches any dimension set), not a
        // dimensionless Metric. Asserts the expression literal is in the dashboard body.
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp($".*SUM\\(SEARCH.*MetricName.*{metricName}.*") })
                })
            })
        }));
    }

    [Fact]
    public void OpsDashboard_UrlOutputExists()
    {
        _template.HasOutput("DashboardUrl", Match.AnyValue());
    }

    [Fact]
    public void Rum_AppMonitorExists_WithTelemetriesAndXRay()
    {
        _template.HasResourceProperties("AWS::RUM::AppMonitor", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Name"] = "notetaker-rum",
            // No-domain template scopes the monitor to the CloudFront default domain,
            // which is a token (Fn::GetAtt) here — assert presence, not a literal.
            ["Domain"] = Match.AnyValue(),
            ["AppMonitorConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["EnableXRay"] = true,
                ["SessionSampleRate"] = 1,
                ["Telemetries"] = Match.ArrayWith(new object[] { "errors", "performance", "http" }),
                ["IdentityPoolId"] = Match.AnyValue(),
                ["GuestRoleArn"] = Match.AnyValue()
            })
        }));
    }

    [Fact]
    public void Rum_AppMonitorScopedToCustomDomain_WhenConfigured()
    {
        _domainTemplate.HasResourceProperties("AWS::RUM::AppMonitor", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Domain"] = "test.note-taker-ai.com"
        }));
    }

    [Fact]
    public void Rum_IdentityPoolAllowsUnauthenticated()
    {
        _template.HasResourceProperties("AWS::Cognito::IdentityPool", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AllowUnauthenticatedIdentities"] = true
        }));
    }

    [Fact]
    public void Rum_GuestRoleCanPutRumEvents()
    {
        // Single action renders as a scalar string, not an array.
        _template.HasResourceProperties("AWS::IAM::Role", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Policies"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Statement"] = Match.ArrayWith(new object[]
                        {
                            Match.ObjectLike(new Dictionary<string, object>
                            {
                                ["Action"] = "rum:PutRumEvents",
                                ["Effect"] = "Allow"
                            })
                        })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Rum_MonitorIdOutputExists()
    {
        _template.HasOutput("RumMonitorId", Match.AnyValue());
    }

    [Fact]
    public void Rum_IdentityPoolIdOutputExists()
    {
        _template.HasOutput("RumIdentityPoolId", Match.AnyValue());
    }

    [Fact]
    public void Alarms_TopicExistsNamedNotetakerAlarms()
    {
        _template.HasResourceProperties("AWS::SNS::Topic", Match.ObjectLike(new Dictionary<string, object>
        {
            ["TopicName"] = "notetaker-alarms"
        }));
    }

    [Fact]
    public void Alarms_TopicHasEmailSubscription()
    {
        _template.HasResourceProperties("AWS::SNS::Subscription", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Protocol"] = "email",
            ["Endpoint"] = "simon.kirkham+note-taker-ai@gmail.com"
        }));
    }

    [Fact]
    public void Alarms_ErrorRateAlarmWiredToTopic()
    {
        // Error rate is a MathExpression (errors / invocations * 100) > 1 over 2 periods.
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-error-rate",
            ["Threshold"] = 1,
            ["EvaluationPeriods"] = 2,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["TreatMissingData"] = "notBreaching",
            ["Metrics"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Expression"] = Match.StringLikeRegexp(".*errors / invocations \\* 100.*")
                })
            }),
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_LatencyAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-p99-latency",
            ["Threshold"] = 5000,
            ["EvaluationPeriods"] = 2,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["ExtendedStatistic"] = "p99",
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_ProjectionRebuildFaultAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-projection-rebuild-fault",
            ["Namespace"] = "NoteTaker/Domain",
            ["MetricName"] = "ProjectionRebuildFault",
            ["Statistic"] = "Sum",
            ["Threshold"] = 0,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["Dimensions"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object> { ["Name"] = "Service", ["Value"] = "note-taker" })
            }),
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_ProjectionRebuildDurationAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-projection-rebuild-duration",
            ["Namespace"] = "NoteTaker/Domain",
            ["MetricName"] = "ProjectionRebuildDuration",
            ["Statistic"] = "Maximum",
            ["Threshold"] = 20000,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["Dimensions"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object> { ["Name"] = "Service", ["Value"] = "note-taker" })
            }),
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_AnalysisFailedAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-analysis-failed",
            ["Namespace"] = "NoteTaker/Domain",
            ["MetricName"] = "AnalysisFailed",
            ["Statistic"] = "Sum",
            ["Threshold"] = 0,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["Dimensions"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object> { ["Name"] = "Service", ["Value"] = "note-taker" })
            }),
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_AllExpectedAlarmsExist()
    {
        // Eight alarms: error-rate, P99 latency, projection-rebuild-fault,
        // projection-rebuild-duration, the three 27-B projector alarms
        // (projector-error, projector-dlq-depth, projector-iterator-age), and
        // analysis-failed (CHANGE-22).
        // A concurrency-conflict alarm is deferred — it would need SUM(SEARCH(...)), which CloudWatch
        // rejects on metric alarms (only allowed on dashboard widgets). See phase-12 12-E.
        _template.ResourceCountIs("AWS::CloudWatch::Alarm", 8);
    }

    [Fact]
    public void OpsDashboard_IncludesRumErrorMetricWidget()
    {
        // 12-H: frontend error counts on the same dashboard. The RUM metric widget
        // reads the AWS/RUM namespace; assert that literal appears in the body.
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*AWS/RUM.*") })
                })
            })
        }));
    }

    [Fact]
    public void OpsDashboard_RumErrorWidgetTitleNotesResourceLoadFailures()
    {
        // TI-37: failed resource loads ride JsErrorCount via cwr('recordError'); the
        // widget title must make that inclusion explicit so the signal isn't lost.
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*resource 403s.*") })
                })
            })
        }));
    }

    [Fact]
    public void OpsDashboard_RumMetricWidgetPlotsJsAndHttpErrorCounts()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*JsErrorCount.*") })
                })
            })
        }));
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*HttpErrorCount.*") })
                })
            })
        }));
    }

    [Fact]
    public void OpsDashboard_UnifiedErrorTableQueriesRumLogGroupAndJsErrorEvent()
    {
        // 12-H: the unified all-errors table also queries the RUM log group
        // (name derived from the monitor GUID via Fn::Select/Fn::Split, not
        // hard-coded) and matches the RUM js_error_event shape.
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*RUMService_notetaker-rum.*") })
                })
            })
        }));
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*com.amazon.rum.js_error_event.*") })
                })
            })
        }));
    }

    [Fact]
    public void SavedQueries_FourQueryDefinitionsExist()
    {
        _template.ResourceCountIs("AWS::Logs::QueryDefinition", 4);
    }

    [Theory]
    [InlineData("NoteTaker/All errors")]
    [InlineData("NoteTaker/By trace ID")]
    [InlineData("NoteTaker/Slowest requests")]
    [InlineData("NoteTaker/Concurrency conflicts")]
    public void SavedQueries_NamedQueryDefinitionExists(string name)
    {
        _template.HasResourceProperties("AWS::Logs::QueryDefinition", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Name"] = name,
            ["QueryString"] = Match.AnyValue(),
            ["LogGroupNames"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void SavedQueries_ConcurrencyConflictsQueryMatchesTheWarningLogLine()
    {
        // Guards that the saved query filters on the exact message the event-store
        // decorator logs ("Concurrency conflict {StreamId} ..."), so it returns data.
        _template.HasResourceProperties("AWS::Logs::QueryDefinition", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Name"] = "NoteTaker/Concurrency conflicts",
            ["QueryString"] = Match.StringLikeRegexp("[\\s\\S]*Concurrency conflict[\\s\\S]*")
        }));
    }

    [Fact]
    public void NoteSearchViewTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-notesearchview"
            })
        }));
    }

    [Fact]
    public void NoteSearchViewTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-notesearchview"
            })
        }));
    }

    [Fact]
    public void NoteSearchViewTable_HasUserIdGsi()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-notesearchview",
                ["GlobalSecondaryIndexes"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["IndexName"] = "UserId-index"
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasNoteSearchViewTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_NOTESEARCHVIEW_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void DraftTranscriptionTable_HasDeleteDeletionPolicy()
    {
        // Working state, not a durable record — DESTROY (CloudFormation "Delete").
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Delete",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-draft-transcription"
            })
        }));
    }

    [Fact]
    public void DraftTranscriptionTable_HasTtlEnabledOnTtlAttribute()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-draft-transcription",
                ["TimeToLiveSpecification"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["AttributeName"] = "TTL",
                    ["Enabled"] = true
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasDraftTranscriptionTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["DRAFT_TRANSCRIPTION_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasLeastPrivilegeGrantOnDraftTranscriptionTable()
    {
        // Only point Get/Put/Delete — never a blanket GrantReadWriteData.
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = Match.ArrayWith(new object[]
                        {
                            "dynamodb:GetItem",
                            "dynamodb:PutItem",
                            "dynamodb:DeleteItem"
                        }),
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    // ── Auth refresh-token store (30-A) ───────────────────────────────

    [Fact]
    public void AuthTokensTable_Exists_WithSubPartitionKey()
    {
        _template.HasResourceProperties("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["TableName"] = "notetaker-auth-tokens",
            ["KeySchema"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object>
                {
                    ["AttributeName"] = "sub",
                    ["KeyType"] = "HASH"
                })
            })
        }));
    }

    [Fact]
    public void AuthTokensTable_HasRetainDeletionPolicy()
    {
        // A long-lived credential only Google can re-issue — never auto-deleted on teardown.
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-auth-tokens"
            })
        }));
    }

    [Fact]
    public void AuthTokensTable_HasServerSideEncryptionEnabled()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-auth-tokens",
                ["SSESpecification"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["SSEEnabled"] = true
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasAuthTokensTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["AUTH_TOKENS_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasCalendarTokensTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["CALENDAR_TOKENS_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void CalendarTokensTable_ExistsWithProviderSortKeyAndRetain()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-calendar-tokens",
                ["KeySchema"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object> { ["AttributeName"] = "sub", ["KeyType"] = "HASH" }),
                    Match.ObjectLike(new Dictionary<string, object> { ["AttributeName"] = "provider", ["KeyType"] = "RANGE" })
                })
            })
        }));
    }

    [Fact]
    public void CommandLambda_HasReadWriteGrantOnAuthTokensTable()
    {
        // Resource-grant path → standard DynamoDB RW action set on the table.
        _template.HasResourceProperties("AWS::IAM::Policy", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = Match.ArrayWith(new object[]
                        {
                            "dynamodb:GetItem",
                            "dynamodb:PutItem",
                            "dynamodb:DeleteItem"
                        }),
                        ["Effect"] = "Allow"
                    })
                })
            })
        }));
    }

    [Fact]
    public void AuthTokensTable_HasNoObjectStyleOverGrant()
    {
        // The refresh-token store is a DynamoDB table — no S3 *Object action should ever be
        // granted against it. Scan every IAM statement that references the auth-tokens table
        // and assert it carries no S3 object action.
        var authTokensLogicalId = AuthTokensTableLogicalId();
        var resources = ToDict(TemplateJson()["Resources"]);
        foreach (var (_, raw) in resources)
        {
            var res = ToDict(raw);
            var type = res.TryGetValue("Type", out var t) ? t as string : null;
            if (type != "AWS::IAM::Policy" && type != "AWS::IAM::ManagedPolicy") continue;
            var doc = ToDict(ToDict(res["Properties"])["PolicyDocument"]);
            foreach (var s in ToArray(doc["Statement"]))
            {
                var stmt = ToDict(s);
                if (!StatementReferencesLogicalId(stmt, authTokensLogicalId)) continue;
                foreach (var action in ActionsOf(stmt))
                    Assert.DoesNotContain("Object", action, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    private static string AuthTokensTableLogicalId()
    {
        var resources = ToDict(TemplateJson()["Resources"]);
        foreach (var (logicalId, raw) in resources)
        {
            var res = ToDict(raw);
            if ((res.TryGetValue("Type", out var t) ? t as string : null) != "AWS::DynamoDB::Table") continue;
            var props = ToDict(res["Properties"]);
            if (props.TryGetValue("TableName", out var name) && name as string == "notetaker-auth-tokens")
                return logicalId;
        }
        throw new Xunit.Sdk.XunitException("auth-tokens table not found in template");
    }

    [Fact]
    public void WorkspaceListTable_Exists()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-workspacelist"
            })
        }));
    }

    [Fact]
    public void WorkspaceListTable_HasRetainDeletionPolicy()
    {
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-workspacelist"
            })
        }));
    }

    [Fact]
    public void Lambda_HasWorkspaceListTableEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_WORKSPACELIST_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasProjPositionTableEnvVar()
    {
        // RYW-1: the API Lambda's consistency gate needs the proj-position table name to poll
        // catch-up. The env var rides the constructor dict so it is in the function-config hash.
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_POSITION_TABLE_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    // ── Note images bucket (Phase 25-A) ──────────────────────────────
    // The images bucket is the only bucket with a CorsConfiguration, so matching on
    // its presence uniquely identifies it (the web bucket has none).

    [Fact]
    public void NoteImagesBucket_HasRetainAndBlocksPublicAccess()
    {
        _template.HasResource("AWS::S3::Bucket", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Retain",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["PublicAccessBlockConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["BlockPublicAcls"] = true,
                    ["BlockPublicPolicy"] = true,
                    ["IgnorePublicAcls"] = true,
                    ["RestrictPublicBuckets"] = true
                }),
                ["CorsConfiguration"] = Match.AnyValue()
            })
        }));
    }

    [Fact]
    public void NoteImagesBucket_HasCorsRuleAllowingPut()
    {
        _template.HasResourceProperties("AWS::S3::Bucket", Match.ObjectLike(new Dictionary<string, object>
        {
            ["CorsConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["CorsRules"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["AllowedMethods"] = Match.ArrayWith(new object[] { "PUT" })
                    })
                })
            })
        }));
    }

    // ── Web bucket asset GC (Phase 26-A) ─────────────────────────────
    // Zero-downtime deploys stop deleting superseded hashed assets at deploy
    // time (no more `s3 sync --delete`); instead a lifecycle rule expires them
    // after a grace window. Scoped to the `assets/` prefix so `index.html` and
    // other unhashed root objects are never GC'd. The 30-day window is unique to
    // the web bucket (the images bucket rule has no Expiration), so matching on
    // ExpirationInDays uniquely identifies it.

    [Fact]
    public void WebBucket_ExpiresSupersededAssetsAfterGraceWindow()
    {
        _template.HasResourceProperties("AWS::S3::Bucket", Match.ObjectLike(new Dictionary<string, object>
        {
            ["LifecycleConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Rules"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Status"] = "Enabled",
                        ["Prefix"] = "assets/",
                        ["ExpirationInDays"] = 30
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasImageBucketEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["IMAGE_BUCKET_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasScopedS3PermissionsForImages()
    {
        // The bucket grant puts read+write object actions in one statement (wildcard
        // forms). Assert each independently — Match.ArrayWith matches in order, so a
        // single-action pattern avoids coupling the test to CDK's action ordering.
        _template.HasResourceProperties("AWS::IAM::Policy", PolicyWithObjectAction("s3:GetObject*"));
        _template.HasResourceProperties("AWS::IAM::Policy", PolicyWithObjectAction("s3:PutObject"));
        _template.HasResourceProperties("AWS::IAM::Policy", PolicyWithObjectAction("s3:DeleteObject*"));
    }

    // ── Recordings bucket (Phase 33-A) ───────────────────────────────
    // Working-artefact bucket: DESTROY + 7-day lifecycle expiry (not durable user
    // data, unlike the RETAIN images bucket). ExpirationInDays=7 is unique to it
    // (web bucket = 30, images bucket has no expiration), so it uniquely identifies
    // the recordings bucket.

    [Fact]
    public void RecordingsBucket_ExpiresObjectsAfterSevenDays()
    {
        _template.HasResourceProperties("AWS::S3::Bucket", Match.ObjectLike(new Dictionary<string, object>
        {
            ["PublicAccessBlockConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["BlockPublicAcls"] = true,
                ["BlockPublicPolicy"] = true,
                ["IgnorePublicAcls"] = true,
                ["RestrictPublicBuckets"] = true
            }),
            ["LifecycleConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Rules"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Status"] = "Enabled",
                        ["ExpirationInDays"] = 7
                    })
                })
            })
        }));
    }

    [Fact]
    public void RecordingsBucket_IsDestroyedOnTeardown()
    {
        // DESTROY removal policy → DeletionPolicy "Delete". Identified by the 7-day
        // lifecycle so it cannot match the RETAIN images bucket or the web bucket.
        _template.HasResource("AWS::S3::Bucket", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Delete",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["LifecycleConfiguration"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Rules"] = Match.ArrayWith(new object[]
                    {
                        Match.ObjectLike(new Dictionary<string, object> { ["ExpirationInDays"] = 7 })
                    })
                })
            })
        }));
    }

    [Fact]
    public void Lambda_HasScopedS3PermissionsForRecordings()
    {
        // Guardrail: the recordings grant must use the resource-grant path scoped to the
        // recordings/ prefix (bucket.GrantReadWrite(fn, "recordings/*")), not a bare
        // AddToRolePolicy. The object-action statement's Resource is the bucket ARN joined
        // with "/recordings/*"; matching that literal uniquely identifies this grant
        // (the images grant is scoped to "/notes/*").
        _template.HasResourceProperties("AWS::IAM::Policy", PolicyWithObjectActionOnPrefix("s3:PutObject", "/recordings/*"));
        _template.HasResourceProperties("AWS::IAM::Policy", PolicyWithObjectActionOnPrefix("s3:GetObject*", "/recordings/*"));
    }

    [Fact]
    public void Lambda_HasRecordingsBucketEnvVar()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["RECORDINGS_BUCKET_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    // ── Phase 27-B: DynamoDB stream + async Projector Lambda ─────────────

    [Fact]
    public void EventsTable_HasNewImageStream()
    {
        _template.HasResourceProperties("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["TableName"] = "notetaker-events",
            ["StreamSpecification"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["StreamViewType"] = "NEW_IMAGE"
            })
        }));
    }

    [Fact]
    public void ProjPositionTable_ExistsWithDestroyDeletionPolicy()
    {
        // Reconstructible by replay — DESTROY (CloudFormation "Delete").
        _template.HasResource("AWS::DynamoDB::Table", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DeletionPolicy"] = "Delete",
            ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["TableName"] = "notetaker-proj-position"
            })
        }));
    }

    [Fact]
    public void ProjectorDlq_QueueExists()
    {
        _template.HasResourceProperties("AWS::SQS::Queue", Match.ObjectLike(new Dictionary<string, object>
        {
            ["QueueName"] = "notetaker-projector-dlq"
        }));
    }

    [Fact]
    public void ProjectorFunction_ExistsWithStreamHandler()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "Projector::Projector.ProjectorFunction::Handle",
            ["MemorySize"] = 512,
            ["Timeout"] = 60
        }));
    }

    [Fact]
    public void ProjectorFunction_HasPositionTableEnvVar()
    {
        // The projector function is the only Lambda carrying PROJ_POSITION_TABLE_NAME —
        // matching on it uniquely identifies the projector function's environment.
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "Projector::Projector.ProjectorFunction::Handle",
            ["Environment"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Variables"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["PROJ_POSITION_TABLE_NAME"] = Match.AnyValue(),
                    ["EVENTS_TABLE_NAME"] = Match.AnyValue(),
                    ["PROJ_NOTETITLELIST_TABLE_NAME"] = Match.AnyValue(),
                    ["IMAGE_BUCKET_NAME"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void ProjectorFunction_HasNoSnapStart()
    {
        // An async throughput consumer, not a request handler — no SnapStart, no alias.
        var thrown = Record.Exception(() =>
            _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
            {
                ["Handler"] = "Projector::Projector.ProjectorFunction::Handle",
                ["SnapStart"] = Match.AnyValue()
            })));
        Assert.NotNull(thrown);
    }

    [Fact]
    public void ProjectorEventSourceMapping_HasBisectRetryAgeAndDlq()
    {
        _template.HasResourceProperties("AWS::Lambda::EventSourceMapping", Match.ObjectLike(new Dictionary<string, object>
        {
            // Enabled for RYW-1: the projector is the async writer for the migrated Todo flow and
            // double-writes the still-inline flows idempotently while the migration scales out.
            ["Enabled"] = true,
            ["StartingPosition"] = "TRIM_HORIZON",
            ["BatchSize"] = 10,
            ["BisectBatchOnFunctionError"] = true,
            ["MaximumRetryAttempts"] = 3,
            ["MaximumRecordAgeInSeconds"] = 86400,
            ["ParallelizationFactor"] = 1,
            ["DestinationConfig"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["OnFailure"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Destination"] = Match.AnyValue()
                })
            })
        }));
    }

    [Fact]
    public void ProjectorRole_HasStreamReadAndEventsTableRead()
    {
        // Positive: the projector's role grants stream-read (GetRecords/GetShardIterator)
        // and item-read (GetItem/Query) so it can fold the log. The grants land on the
        // projector role's policies (a DefaultPolicy plus a CDK-split Overflow managed
        // policy when the statement set exceeds the inline size limit), so scan both
        // AWS::IAM::Policy and AWS::IAM::ManagedPolicy.
        var actions = ProjectorRoleActions();
        Assert.Contains("dynamodb:GetRecords", actions);
        Assert.Contains("dynamodb:GetItem", actions);
        Assert.Contains("dynamodb:Query", actions);
    }

    [Fact]
    public void ProjectorRole_HasNoEventsTableWrite()
    {
        // Load-bearing least-privilege boundary: the projector can read/re-fold the events
        // table but can NEVER append to it. No statement on the projector role scoped to the
        // events-table ARN may grant a write verb (PutItem/UpdateItem/DeleteItem/
        // BatchWriteItem/TransactWriteItems). The 12 projection-table grants are read/write
        // (those carry PutItem etc.), so we must check the actions of the statements scoped
        // to the EVENTS table specifically — not a blanket "no PutItem anywhere".
        var eventsLogicalId = EventsTableLogicalId();
        var writeVerbs = new[]
        {
            "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
            "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems"
        };
        foreach (var stmt in ProjectorRoleStatements())
        {
            if (!StatementReferencesLogicalId(stmt, eventsLogicalId)) continue;
            var actions = ActionsOf(stmt);
            foreach (var verb in writeVerbs)
                Assert.DoesNotContain(verb, actions);
        }
        // And sanity: the events table IS referenced by at least one projector statement
        // (otherwise the loop above is vacuously true).
        Assert.Contains(ProjectorRoleStatements(),
            s => StatementReferencesLogicalId(s, eventsLogicalId));
    }

    [Fact]
    public void ProjectorRole_CanSendToDlq()
    {
        Assert.Contains("sqs:SendMessage", ProjectorRoleActions());
    }

    [Fact]
    public void ProjectorRole_CanListAndDeleteImagesScopedToNotesPrefix()
    {
        var actions = ProjectorRoleActions();
        // NoteDeleted purge path LISTS the note's objects then DELETEs them. BUG-29: ListBucket was
        // missing (delete-only grant), so every delete-purge failed AccessDenied in prod.
        Assert.Contains("s3:DeleteObject*", actions);
        Assert.Contains(actions, a => a.Contains("List", StringComparison.Ordinal));
        // Still never a write/put on the image bucket from the projector.
        Assert.DoesNotContain("s3:PutObject", actions);
    }

    [Fact]
    public void Alarms_ProjectorErrorAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-projector-error",
            ["Namespace"] = "NoteTaker/Domain",
            ["MetricName"] = "ProjectorFailure",
            ["Statistic"] = "Sum",
            ["Threshold"] = 0,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["Dimensions"] = Match.ArrayWith(new object[]
            {
                Match.ObjectLike(new Dictionary<string, object> { ["Name"] = "Service", ["Value"] = "note-taker-projector" })
            }),
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_ProjectorDlqDepthAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-projector-dlq-depth",
            ["Namespace"] = "AWS/SQS",
            ["MetricName"] = "ApproximateNumberOfMessagesVisible",
            ["Threshold"] = 0,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void Alarms_ProjectorIteratorAgeAlarmWiredToTopic()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Alarm", Match.ObjectLike(new Dictionary<string, object>
        {
            ["AlarmName"] = "notetaker-projector-iterator-age",
            ["Namespace"] = "AWS/Lambda",
            ["MetricName"] = "IteratorAge",
            ["Threshold"] = 60000,
            ["ComparisonOperator"] = "GreaterThanThreshold",
            ["AlarmActions"] = Match.AnyValue()
        }));
    }

    [Fact]
    public void OpsDashboard_HasProjectorWidget()
    {
        _template.HasResourceProperties("AWS::CloudWatch::Dashboard", Match.ObjectLike(new Dictionary<string, object>
        {
            ["DashboardBody"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Fn::Join"] = Match.ArrayWith(new object[]
                {
                    Match.ArrayWith(new object[] { Match.StringLikeRegexp(".*ProjectorLag.*") })
                })
            })
        }));
    }

    // ── Projector IAM helpers ────────────────────────────────────────────
    // The projector role's grants are split across an inline AWS::IAM::Policy
    // (DefaultPolicy) and, when the statement set overflows the inline size limit,
    // an attached AWS::IAM::ManagedPolicy (OverflowPolicy). Scan both, walking the
    // raw template JSON so a scalar Action ("s3:DeleteObject*") and an array Action
    // are both handled. Projector policies are identified by their logical id prefix.

    private static Dictionary<string, object> TemplateJson() =>
        ToDict(_template.ToJSON());

    private static IEnumerable<Dictionary<string, object>> ProjectorRoleStatements()
    {
        var resources = ToDict(TemplateJson()["Resources"]);
        foreach (var (logicalId, raw) in resources)
        {
            if (!logicalId.StartsWith("ProjectorFunctionServiceRole")) continue;
            var res = ToDict(raw);
            var type = res.TryGetValue("Type", out var t) ? t as string : null;
            if (type != "AWS::IAM::Policy" && type != "AWS::IAM::ManagedPolicy") continue;
            var props = ToDict(res["Properties"]);
            var doc = ToDict(props["PolicyDocument"]);
            foreach (var s in ToArray(doc["Statement"]))
                yield return ToDict(s);
        }
    }

    private static HashSet<string> ProjectorRoleActions()
    {
        var actions = new HashSet<string>();
        foreach (var stmt in ProjectorRoleStatements())
            foreach (var a in ActionsOf(stmt))
                actions.Add(a);
        return actions;
    }

    private static IEnumerable<string> ActionsOf(Dictionary<string, object> statement)
    {
        if (!statement.TryGetValue("Action", out var a)) yield break;
        if (a is string s) { yield return s; yield break; }
        foreach (var x in ToArray(a))
            if (x is string str) yield return str;
    }

    private static string EventsTableLogicalId()
    {
        var resources = ToDict(TemplateJson()["Resources"]);
        foreach (var (logicalId, raw) in resources)
        {
            var res = ToDict(raw);
            if ((res.TryGetValue("Type", out var t) ? t as string : null) != "AWS::DynamoDB::Table") continue;
            var props = ToDict(res["Properties"]);
            if (props.TryGetValue("TableName", out var name) && name as string == "notetaker-events")
                return logicalId;
        }
        throw new Xunit.Sdk.XunitException("events table not found in template");
    }

    // True if any Resource ARN in the statement is built from a Fn::GetAtt on the
    // given logical id (covers both the table ARN and its StreamArn).
    private static bool StatementReferencesLogicalId(Dictionary<string, object> statement, string logicalId)
    {
        if (!statement.TryGetValue("Resource", out var r)) return false;
        return JsonMentions(r, logicalId);
    }

    private static bool JsonMentions(object? node, string needle)
    {
        switch (node)
        {
            case string s:
                return s == needle;
            case IDictionary<string, object> map:
                return map.Any(kv => kv.Key == needle || JsonMentions(kv.Value, needle));
            case System.Collections.IEnumerable seq:
                return seq.Cast<object?>().Any(x => JsonMentions(x, needle));
            default:
                return false;
        }
    }

    private static Dictionary<string, object> ToDict(object? o) =>
        o is IDictionary<string, object> d
            ? new Dictionary<string, object>(d)
            : new Dictionary<string, object>();

    private static IEnumerable<object> ToArray(object? o) =>
        o is System.Collections.IEnumerable e and not string
            ? e.Cast<object>()
            : Enumerable.Empty<object>();

    private static object PolicyWithObjectAction(string action) =>
        Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = Match.ArrayWith(new object[] { action }),
                        ["Effect"] = "Allow"
                    })
                })
            })
        });

    // Like PolicyWithObjectAction but also requires the statement's Resource to be the
    // bucket ARN joined with the given object-key prefix (e.g. "/recordings/*") — proving
    // the grant is scoped to that prefix, not bucket-wide.
    private static object PolicyWithObjectActionOnPrefix(string action, string keyPrefix) =>
        Match.ObjectLike(new Dictionary<string, object>
        {
            ["PolicyDocument"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["Statement"] = Match.ArrayWith(new object[]
                {
                    Match.ObjectLike(new Dictionary<string, object>
                    {
                        ["Action"] = Match.ArrayWith(new object[] { action }),
                        ["Effect"] = "Allow",
                        ["Resource"] = Match.ArrayWith(new object[]
                        {
                            Match.ObjectLike(new Dictionary<string, object>
                            {
                                ["Fn::Join"] = Match.ArrayWith(new object[]
                                {
                                    Match.ArrayWith(new object[] { keyPrefix })
                                })
                            })
                        })
                    })
                })
            })
        });

    // ── Phase 27-D: split the HTTP Lambda into Command + Query functions ──
    // The single request Lambda becomes two: a Command function (writes + side
    // services + admin rebuild) invoked via $LATEST, and a Query function (reads
    // only) behind a SnapStart `live` alias. API Gateway routes by method: GETs to
    // Query, write methods to Command, plus two side-service GETs (calendar, transcribe
    // credentials) pinned to Command because they need Google/SSM/STS, not projections.
    // Both run the SAME binary (Handler "Api"); the split is enforced by routing + IAM,
    // not by code. Functions are distinguished in assertions by their Description.

    private const string CommandDescription = "AI Note Taker Command API";
    private const string QueryDescription = "AI Note Taker Query API";

    [Fact]
    public void Split_CommandFunctionExists_NoSnapStart()
    {
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "Api",
            ["Description"] = CommandDescription,
            ["MemorySize"] = 512
        }));
        // Writes are masked by optimistic UI, so the Command function pays no SnapStart
        // snapshot cost (the deploy-time guardrail: only one SnapStart publish remains).
        var thrown = Record.Exception(() =>
            _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
            {
                ["Description"] = CommandDescription,
                ["SnapStart"] = Match.AnyValue()
            })));
        Assert.NotNull(thrown);
    }

    [Fact]
    public void Split_QueryFunctionExists_WithSnapStart()
    {
        // The latency-critical read path keeps SnapStart (on published versions → live alias).
        _template.HasResourceProperties("AWS::Lambda::Function", Match.ObjectLike(new Dictionary<string, object>
        {
            ["Handler"] = "Api",
            ["Description"] = QueryDescription,
            ["MemorySize"] = 512,
            ["SnapStart"] = Match.ObjectLike(new Dictionary<string, object>
            {
                ["ApplyOn"] = "PublishedVersions"
            })
        }));
    }

    [Fact]
    public void Split_ExactlyTwoRequestFunctions_PlusProjector()
    {
        // Two request functions (Handler "Api") + one projector. FindResources counts
        // only Lambda functions; the log-retention provider lambdas have a different
        // (auto-generated) handler, so filter to the two we own.
        var apiFns = _template.FindResources("AWS::Lambda::Function",
            Match.ObjectLike(new Dictionary<string, object>
            {
                ["Properties"] = Match.ObjectLike(new Dictionary<string, object> { ["Handler"] = "Api" })
            }));
        Assert.Equal(2, apiFns.Count);
        // …and the projector still exists alongside them (the 3-Lambda Stage-1 shape) —
        // guard against an accidental projector deletion while editing this region.
        var projectorFns = _template.FindResources("AWS::Lambda::Function",
            Match.ObjectLike(new Dictionary<string, object>
            {
                ["Properties"] = Match.ObjectLike(new Dictionary<string, object>
                {
                    ["Handler"] = "Projector::Projector.ProjectorFunction::Handle"
                })
            }));
        Assert.Single(projectorFns);
    }

    // ── Routing: method → function ───────────────────────────────────────

    [Fact]
    public void Routing_GetCatchAll_TargetsQuery()
    {
        Assert.True(RouteTargetsFunction("GET /{proxy+}", "QueryFunction"));
    }

    [Theory]
    [InlineData("POST /{proxy+}")]
    [InlineData("PUT /{proxy+}")]
    [InlineData("PATCH /{proxy+}")]
    [InlineData("DELETE /{proxy+}")]
    public void Routing_WriteMethods_TargetCommand(string routeKey)
    {
        Assert.True(RouteTargetsFunction(routeKey, "CommandFunction"));
    }

    [Fact]
    public void Routing_CalendarGet_TargetsCommand_NotQuery()
    {
        // GET, but needs Google + SSM — pinned to Command so Query stays projection-only.
        Assert.True(RouteTargetsFunction("GET /calendar/{date}", "CommandFunction"));
    }

    [Fact]
    public void Routing_TranscribeCredentialsGet_TargetsCommand_NotQuery()
    {
        // GET, but issues STS AssumeRole — pinned to Command.
        Assert.True(RouteTargetsFunction("GET /transcription/credentials", "CommandFunction"));
    }

    // ── Least privilege: Query is read-only, no event store ──────────────

    [Fact]
    public void QueryRole_HasNoDynamoWriteVerbs()
    {
        // Load-bearing read-path boundary: the Query function can never mutate any
        // DynamoDB item — not a projection, not the event store, nothing.
        var writeVerbs = new[]
        {
            "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
            "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems"
        };
        var actions = RoleActions("QueryFunctionServiceRole");
        // Sanity: the role exists and has some grants (otherwise vacuously true).
        Assert.NotEmpty(actions);
        foreach (var verb in writeVerbs)
            Assert.DoesNotContain(verb, actions);
    }

    [Fact]
    public void QueryRole_HasNoEventsTableDataAccess()
    {
        // The Query function never reads or writes event-store DATA. A metadata-only
        // DescribeTable (the /health probe) is the sole permitted events-table action.
        var eventsLogicalId = EventsTableLogicalId();
        var dataVerbs = new[]
        {
            "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
            "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
            "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems", "dynamodb:GetRecords"
        };
        foreach (var stmt in RoleStatements("QueryFunctionServiceRole"))
        {
            if (!StatementReferencesLogicalId(stmt, eventsLogicalId)) continue;
            var actions = ActionsOf(stmt).ToHashSet();
            foreach (var verb in dataVerbs)
                Assert.DoesNotContain(verb, actions);
        }
        // Non-vacuous: the events table IS referenced by the Query role — by the
        // metadata-only DescribeTable grant the /health probe needs — and only that.
        var eventsActions = RoleStatements("QueryFunctionServiceRole")
            .Where(s => StatementReferencesLogicalId(s, eventsLogicalId))
            .SelectMany(ActionsOf)
            .ToHashSet();
        Assert.Equal(new HashSet<string> { "dynamodb:DescribeTable" }, eventsActions);
    }

    [Fact]
    public void QueryRole_CanReadProjections()
    {
        var actions = RoleActions("QueryFunctionServiceRole");
        Assert.Contains("dynamodb:GetItem", actions);
        Assert.Contains("dynamodb:Query", actions);
    }

    // ── Least privilege: Command keeps writes + side services ────────────

    [Fact]
    public void CommandRole_HasEventStoreWriteAndTransact()
    {
        var actions = RoleActions("CommandFunctionServiceRole");
        Assert.Contains("dynamodb:TransactWriteItems", actions);
        var eventsLogicalId = EventsTableLogicalId();
        var writeVerbs = new[] { "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem" };
        var writesEvents = RoleStatements("CommandFunctionServiceRole")
            .Where(s => StatementReferencesLogicalId(s, eventsLogicalId))
            .SelectMany(ActionsOf)
            .Any(a => writeVerbs.Contains(a));
        Assert.True(writesEvents, "Command role must hold a write verb scoped to the events table");
    }

    [Fact]
    public void CommandRole_HasSideServiceGrants()
    {
        var actions = RoleActions("CommandFunctionServiceRole");
        Assert.Contains("bedrock:InvokeModel", actions);
        Assert.Contains("sts:AssumeRole", actions);
    }

    [Fact]
    public void QueryRole_HasNoSideServiceGrants()
    {
        // The read path holds none of the write-path credentials. The two GETs that need
        // them (calendar → Google/SSM, transcribe credentials → STS) route to Command.
        var actions = RoleActions("QueryFunctionServiceRole");
        Assert.DoesNotContain("bedrock:InvokeModel", actions);
        Assert.DoesNotContain("sts:AssumeRole", actions);
        Assert.DoesNotContain("ssm:GetParameter", actions);
    }

    // ── 27-D helpers ─────────────────────────────────────────────────────

    private static IEnumerable<Dictionary<string, object>> RoleStatements(string rolePrefix)
    {
        var resources = ToDict(TemplateJson()["Resources"]);
        foreach (var (logicalId, raw) in resources)
        {
            if (!logicalId.StartsWith(rolePrefix)) continue;
            var res = ToDict(raw);
            var type = res.TryGetValue("Type", out var t) ? t as string : null;
            if (type != "AWS::IAM::Policy" && type != "AWS::IAM::ManagedPolicy") continue;
            var props = ToDict(res["Properties"]);
            var doc = ToDict(props["PolicyDocument"]);
            foreach (var s in ToArray(doc["Statement"]))
                yield return ToDict(s);
        }
    }

    private static HashSet<string> RoleActions(string rolePrefix)
    {
        var actions = new HashSet<string>();
        foreach (var stmt in RoleStatements(rolePrefix))
            foreach (var a in ActionsOf(stmt))
                actions.Add(a);
        return actions;
    }

    // Resolve an ApiGatewayV2 route by its RouteKey ("GET /{proxy+}"), follow its
    // Target to the integration, and assert the integration's URI is built from a
    // logical id with the given function prefix (the function or its alias).
    private static bool RouteTargetsFunction(string routeKey, string functionPrefix)
    {
        var resources = ToDict(TemplateJson()["Resources"]);
        string? integrationId = null;
        foreach (var (_, raw) in resources)
        {
            var res = ToDict(raw);
            if ((res.TryGetValue("Type", out var t) ? t as string : null) != "AWS::ApiGatewayV2::Route") continue;
            var props = ToDict(res["Properties"]);
            if (!(props.TryGetValue("RouteKey", out var rk) && rk as string == routeKey)) continue;
            integrationId = ExtractFirstRef(props.TryGetValue("Target", out var tgt) ? tgt : null);
            break;
        }
        if (integrationId is null)
            throw new Xunit.Sdk.XunitException($"route '{routeKey}' not found in template");
        if (!resources.TryGetValue(integrationId, out var integRaw))
            throw new Xunit.Sdk.XunitException($"integration '{integrationId}' for route '{routeKey}' not found");
        var integProps = ToDict(ToDict(integRaw)["Properties"]);
        return JsonMentionsPrefix(integProps.TryGetValue("IntegrationUri", out var uri) ? uri : null, functionPrefix);
    }

    private static string? ExtractFirstRef(object? node)
    {
        switch (node)
        {
            case IDictionary<string, object> map:
                if (map.TryGetValue("Ref", out var r) && r is string s) return s;
                foreach (var v in map.Values)
                {
                    var found = ExtractFirstRef(v);
                    if (found is not null) return found;
                }
                return null;
            case System.Collections.IEnumerable seq and not string:
                foreach (var x in seq.Cast<object?>())
                {
                    var found = ExtractFirstRef(x);
                    if (found is not null) return found;
                }
                return null;
            default:
                return null;
        }
    }

    // True if any string value or dict key in the JSON node starts with the prefix —
    // used to match an integration URI built from "QueryFunction…"/"CommandFunction…"
    // logical ids (covers both a function and its alias, e.g. "QueryFunctionLiveAlias").
    private static bool JsonMentionsPrefix(object? node, string prefix)
    {
        switch (node)
        {
            case string str:
                return str.StartsWith(prefix);
            case IDictionary<string, object> map:
                return map.Any(kv => kv.Key.StartsWith(prefix) || JsonMentionsPrefix(kv.Value, prefix));
            case System.Collections.IEnumerable seq:
                return seq.Cast<object?>().Any(x => JsonMentionsPrefix(x, prefix));
            default:
                return false;
        }
    }
}
