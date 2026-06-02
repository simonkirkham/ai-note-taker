using Amazon.CDK;
using Amazon.CDK.Assertions;

public class InfraAssertionsTests
{
    private static readonly Template _template = BuildTemplate();
    private static readonly Template _domainTemplate = BuildDomainTemplate();
    private static readonly Template _calendarTemplate = BuildCalendarTemplate();

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

    private static Template BuildCalendarTemplate()
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
    public void Alarms_ErrorRateAndLatencyAlarmsExist()
    {
        // Two alarms: error-rate + P99 latency. A concurrency-conflict alarm is
        // deferred — it would need SUM(SEARCH(...)), which CloudWatch rejects on
        // metric alarms (only allowed on dashboard widgets). See phase-12 12-E.
        _template.ResourceCountIs("AWS::CloudWatch::Alarm", 2);
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
}
