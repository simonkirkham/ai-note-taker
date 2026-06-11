using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.Cognito;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53.Targets;
using Amazon.CDK.AWS.RUM;
using Amazon.CDK.AWS.S3;
using Constructs;

public sealed class NoteTakerStack : Stack
{
    public NoteTakerStack(Construct scope, string id, NoteTakerStackProps props) : base(scope, id, props)
    {
        // ── Event store ──────────────────────────────────────────────────
        var eventsTable = new Table(this, "EventsTable", new TableProps
        {
            TableName = "notetaker-events",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // ── Projection tables ────────────────────────────────────────────
        var projTable = new Table(this, "ProjNoteTitleListTable", new TableProps
        {
            TableName = "notetaker-proj-notetitlelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var noteDetailTable = new Table(this, "ProjNoteDetailTable", new TableProps
        {
            TableName = "notetaker-proj-notedetail",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var noteActionsTable = new Table(this, "ProjNoteActionsTable", new TableProps
        {
            TableName = "notetaker-proj-noteactions",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var todoListTable = new Table(this, "ProjTodoListTable", new TableProps
        {
            TableName = "notetaker-proj-todolist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        todoListTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "NoteId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "NoteId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var noteCardListTable = new Table(this, "ProjNoteCardListTable", new TableProps
        {
            TableName = "notetaker-proj-notecardlist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var folderTreeTable = new Table(this, "ProjFolderTreeTable", new TableProps
        {
            TableName = "notetaker-proj-foldertree",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var tagIndexTable = new Table(this, "ProjTagIndexTable", new TableProps
        {
            TableName = "notetaker-proj-tagindex",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "Tag", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "NoteId", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var tagFeedbackTable = new Table(this, "ProjTagFeedbackTable", new TableProps
        {
            TableName = "notetaker-proj-tagfeedback",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var actionFeedbackTable = new Table(this, "ProjActionFeedbackTable", new TableProps
        {
            TableName = "notetaker-proj-actionfeedback",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var calendarLinkIndexTable = new Table(this, "ProjCalendarLinkIndexTable", new TableProps
        {
            TableName = "notetaker-proj-calendarlinkindex",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "CalendarEventId", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            PointInTimeRecoverySpecification = new PointInTimeRecoverySpecification { PointInTimeRecoveryEnabled = true },
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        calendarLinkIndexTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "RecurringSeriesId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "RecurringSeriesId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var noteSearchViewTable = new Table(this, "ProjNoteSearchViewTable", new TableProps
        {
            TableName = "notetaker-proj-notesearchview",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });
        noteSearchViewTable.AddGlobalSecondaryIndex(new GlobalSecondaryIndexProps
        {
            IndexName = "UserId-index",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "UserId", Type = AttributeType.STRING },
            ProjectionType = ProjectionType.ALL
        });

        var workspaceListTable = new Table(this, "ProjWorkspaceListTable", new TableProps
        {
            TableName = "notetaker-proj-workspacelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // ── Working-state store (NOT a projection, NOT the event log) ─────
        // In-progress transcription drafts, overwritten in place and self-reaped
        // via TTL. Loss-tolerant recovery buffer (ADR 0011): DESTROY removal,
        // since nothing authoritative lives here.
        var draftTranscriptionTable = new Table(this, "DraftTranscriptionTable", new TableProps
        {
            TableName = "notetaker-draft-transcription",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            TimeToLiveAttribute = "TTL",
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // ── Note images (user-uploaded blobs) ────────────────────────────
        // Private bucket: the browser uploads/downloads directly via presigned URLs,
        // so CORS must allow PUT/GET. RETAIN — user data is never auto-deleted on a
        // stack teardown. Created before the Lambda so its name goes in the function's
        // constructor Environment dict (a token there is part of the hashed config,
        // exactly like the table names) rather than a post-construction AddEnvironment.
        var imagesBucket = new Bucket(this, "NoteImagesBucket", new BucketProps
        {
            RemovalPolicy = RemovalPolicy.RETAIN,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            AutoDeleteObjects = false,
            Encryption = BucketEncryption.S3_MANAGED,
            Cors = new[]
            {
                new CorsRule
                {
                    AllowedMethods = new[] { HttpMethods.PUT, HttpMethods.GET },
                    AllowedOrigins = new[] { "*" },
                    AllowedHeaders = new[] { "*" },
                    MaxAge = 3000
                }
            },
            LifecycleRules = new[]
            {
                new LifecycleRule { AbortIncompleteMultipartUploadAfter = Duration.Days(1) }
            }
        });

        // ── API Lambda ───────────────────────────────────────────────────
        var lambdaAssetPath = (string?)this.Node.TryGetContext("lambdaAssetPath")
            ?? "src/Api/bin/Release/net10.0/publish";

        // Explicit log group so retention is managed (and cost-bounded) rather
        // than letting the runtime auto-create an unmanaged, never-expiring group.
        var apiLogGroup = new Amazon.CDK.AWS.Logs.LogGroup(this, "ApiFunctionLogGroup", new Amazon.CDK.AWS.Logs.LogGroupProps
        {
            Retention = Amazon.CDK.AWS.Logs.RetentionDays.ONE_MONTH,
            RemovalPolicy = RemovalPolicy.DESTROY
        });

        // Production Bedrock model for transcript analysis. Single source of truth:
        // drives both the Lambda's BEDROCK_MODEL_ID env var and the InvokeModel IAM
        // scope below. To switch the prod model after an eval run, change the default
        // literal here and deploy (the decision is recorded in docs/eval-runs/). An
        // optional BEDROCK_MODEL_ID override is still honoured if ever set.
        var bedrockModelId = string.IsNullOrEmpty(props.BedrockModelId)
            ? "amazon.nova-lite-v1:0"
            : props.BedrockModelId;

        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Api",
            Description = "AI Note Taker API",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(lambdaAssetPath),
            Timeout = Duration.Seconds(29),
            // 256 MB: observed peak Max Memory Used is ~165 MB, so this leaves
            // ~55% headroom. SnapStart snapshot-cache cost is billed per GB of
            // memory, so this also roughly halves the dominant Lambda cost line
            // (snapshot cache storage) versus the previous 512 MB.
            MemorySize = 256,
            LogGroup = apiLogGroup,
            SnapStart = Amazon.CDK.AWS.Lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
            Tracing = Amazon.CDK.AWS.Lambda.Tracing.ACTIVE,
            Environment = new Dictionary<string, string>
            {
                // Defensive: with active tracing the Lambda runtime always provides a
                // segment, but log rather than throw if the X-Ray context is ever absent.
                ["AWS_XRAY_CONTEXT_MISSING"] = "LOG_ERROR",
                ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
                ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName,
                ["PROJ_NOTEDETAIL_TABLE_NAME"] = noteDetailTable.TableName,
                ["PROJ_NOTEACTIONS_TABLE_NAME"] = noteActionsTable.TableName,
                ["PROJ_TODOLIST_TABLE_NAME"] = todoListTable.TableName,
                ["PROJ_NOTECARDLIST_TABLE_NAME"] = noteCardListTable.TableName,
                ["PROJ_FOLDERTREE_TABLE_NAME"] = folderTreeTable.TableName,
                ["PROJ_TAGINDEX_TABLE_NAME"] = tagIndexTable.TableName,
                ["PROJ_TAGFEEDBACK_TABLE_NAME"] = tagFeedbackTable.TableName,
                ["PROJ_ACTIONFEEDBACK_TABLE_NAME"] = actionFeedbackTable.TableName,
                // Always present even when unset so runtime code reads "" rather than throwing on missing key.
                // Use string.IsNullOrEmpty() on the consumer side; the key itself is always there.
                ["GOOGLE_CLIENT_ID"] = props.GoogleClientId ?? "",
                ["GOOGLE_CLIENT_SECRET"] = props.GoogleClientSecret ?? "",
                ["ALLOWED_USER_SUBS"] = props.AllowedUserSubs ?? "",
                ["GOOGLE_REFRESH_TOKEN_SSM_PATH"] = props.GoogleRefreshTokenSsmPath ?? "",
                ["PROJ_CALENDARLINKINDEX_TABLE_NAME"] = calendarLinkIndexTable.TableName,
                ["PROJ_NOTESEARCHVIEW_TABLE_NAME"] = noteSearchViewTable.TableName,
                ["DRAFT_TRANSCRIPTION_TABLE_NAME"] = draftTranscriptionTable.TableName,
                ["IMAGE_BUCKET_NAME"] = imagesBucket.BucketName,
                ["PROJ_WORKSPACELIST_TABLE_NAME"] = workspaceListTable.TableName,
                ["BEDROCK_MODEL_ID"] = bedrockModelId
            }
        });

        // ── Transcribe browser role ──────────────────────────────────────
        // Scoped role the Lambda issues to the browser via STS AssumeRole.
        // Trust policy allows only this Lambda's execution role to assume it.
        // Defined before the alias so that AddEnvironment is called before
        // CurrentVersion is first accessed; CDK v2 hashes function configuration
        // at that point, and env vars set afterwards are excluded from the hash.
        var transcribeRole = new Role(this, "TranscribeBrowserRole", new RoleProps
        {
            AssumedBy = new ArnPrincipal(apiFunction.Role!.RoleArn),
            Description = "Scoped credentials for browser-held AWS Transcribe Streaming sessions",
            InlinePolicies = new Dictionary<string, PolicyDocument>
            {
                ["TranscribeStreamingOnly"] = new PolicyDocument(new PolicyDocumentProps
                {
                    Statements = new[]
                    {
                        new PolicyStatement(new PolicyStatementProps
                        {
                            // Both actions are required: the HTTP/2 variant and the WebSocket
                            // variant used by @aws-sdk/client-transcribe-streaming in browsers.
                            Actions = new[]
                            {
                                "transcribe:StartStreamTranscription",
                                "transcribe:StartStreamTranscriptionWebSocket"
                            },
                            Resources = new[] { "*" }
                        })
                    }
                })
            }
        });
        apiFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Actions = new[] { "sts:AssumeRole" },
            Resources = new[] { transcribeRole.RoleArn }
        }));
        apiFunction.AddEnvironment("TRANSCRIBE_ROLE_ARN", transcribeRole.RoleArn);

        // Cross-region inference profiles (eu./us./ap. prefix) require two IAM ARNs:
        //   - inference-profile: includes account ID, scoped to the deployment region
        //   - foundation-model:  no account ID, wildcard region (Bedrock routes internally)
        // Direct foundation model IDs only need the foundation-model ARN (no account ID).
        string[] bedrockResources;
        if (bedrockModelId.Length > 3 && bedrockModelId[2] == '.')
        {
            var baseModelId = bedrockModelId[3..];
            bedrockResources =
            [
                Arn.Format(new ArnComponents { Service = "bedrock", Resource = "inference-profile", ResourceName = bedrockModelId }, this),
                $"arn:aws:bedrock:*::foundation-model/{baseModelId}"
            ];
        }
        else
        {
            bedrockResources =
            [
                Arn.Format(new ArnComponents { Service = "bedrock", Resource = "foundation-model", ResourceName = bedrockModelId, Account = string.Empty }, this)
            ];
        }
        apiFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Actions = new[] { "bedrock:InvokeModel" },
            Resources = bedrockResources
        }));
        // Note images: object read/write scoped to the note image prefix. Uses the
        // bucket grant (not apiFunction.AddToRolePolicy / Role.AddToPrincipalPolicy with
        // a bespoke statement): adding a distinct statement that way silently drops the
        // conditional post-CurrentVersion SSM grant, whereas the bucket grant does not.
        imagesBucket.GrantReadWrite(apiFunction, "notes/*");

        var apiAlias = new Amazon.CDK.AWS.Lambda.Alias(this, "LiveAlias", new Amazon.CDK.AWS.Lambda.AliasProps
        {
            AliasName = "live",
            Version = apiFunction.CurrentVersion
        });

        eventsTable.GrantReadWriteData(apiFunction);
        eventsTable.Grant(apiFunction, "dynamodb:TransactWriteItems");
        projTable.GrantReadWriteData(apiFunction);
        noteDetailTable.GrantReadWriteData(apiFunction);
        noteActionsTable.GrantReadWriteData(apiFunction);
        todoListTable.GrantReadWriteData(apiFunction);
        noteCardListTable.GrantReadWriteData(apiFunction);
        folderTreeTable.GrantReadWriteData(apiFunction);
        tagIndexTable.GrantReadWriteData(apiFunction);
        tagFeedbackTable.GrantReadWriteData(apiFunction);
        actionFeedbackTable.GrantReadWriteData(apiFunction);
        calendarLinkIndexTable.GrantReadWriteData(apiFunction);
        noteSearchViewTable.GrantReadWriteData(apiFunction);
        workspaceListTable.GrantReadWriteData(apiFunction);
        // Least-privilege: the draft store only ever does point Get/Put/Delete.
        draftTranscriptionTable.Grant(apiFunction, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem");

        if (!string.IsNullOrEmpty(props.GoogleRefreshTokenSsmPath))
        {
            var ssmArn = Arn.Format(new ArnComponents
            {
                Service = "ssm",
                Resource = "parameter",
                ResourceName = props.GoogleRefreshTokenSsmPath.TrimStart('/')
            }, this);
            apiFunction.AddToRolePolicy(new PolicyStatement(new PolicyStatementProps
            {
                Actions = new[] { "ssm:GetParameter" },
                Resources = new[] { ssmArn }
            }));
        }

        // ── API Gateway ──────────────────────────────────────────────────
        // CORS is handled by ASP.NET Core UseCors middleware in the Lambda, not at
        // the API Gateway level. API Gateway's CorsPreflight + a /{proxy+} ANY catch-all
        // produces a 405 for OPTIONS preflight because the two conflict; removing it lets
        // OPTIONS flow through to Lambda where UseCors returns 200 with the right headers.
        var httpApi = new Amazon.CDK.AWS.Apigatewayv2.HttpApi(this, "HttpApi", new Amazon.CDK.AWS.Apigatewayv2.HttpApiProps
        {
            ApiName = "notetaker-api",
        });

        // HTTP API's ANY method does not include OPTIONS — OPTIONS must be routed
        // explicitly so that ASP.NET Core's UseCors middleware can handle CORS preflights.
        var lambdaIntegration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
            "LambdaIntegration", apiAlias);

        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.ANY },
            Integration = lambdaIntegration
        });

        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.OPTIONS },
            Integration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
                "LambdaOptionsIntegration", apiAlias)
        });

        // ── Frontend (S3 + CloudFront) ───────────────────────────────────
        var webBucket = new Bucket(this, "WebBucket", new BucketProps
        {
            RemovalPolicy = RemovalPolicy.RETAIN,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            AutoDeleteObjects = false,
            // Zero-downtime deploy (Phase 26-A): the deploy no longer `s3 sync --delete`s
            // superseded hashed bundles, so a browser/CDN still holding the previous
            // index.html keeps finding its assets. They are reaped here instead, 30 days
            // after they stop being re-uploaded. Scoped to `assets/` (Vite's hashed-asset
            // dir) so index.html and other unhashed root objects are never expired.
            // A still-referenced asset is re-synced from a fresh build each deploy, which
            // refreshes its LastModified, so it never ages into the window while live.
            LifecycleRules = new[]
            {
                new LifecycleRule
                {
                    Id = "expire-superseded-assets",
                    Enabled = true,
                    Prefix = "assets/",
                    Expiration = Duration.Days(30)
                }
            }
        });

        var distribution = new Distribution(this, "WebDistribution", BuildDistributionProps(props, httpApi, webBucket));

        // ── Route 53 alias (custom domain only) ─────────────────────────
        if (!string.IsNullOrEmpty(props.DomainName) && !string.IsNullOrEmpty(props.HostedZoneId))
        {
            var hostedZone = HostedZone.FromHostedZoneAttributes(this, "HostedZone", new HostedZoneAttributes
            {
                HostedZoneId = props.HostedZoneId,
                ZoneName = DomainHelpers.ApexDomain(props.DomainName)
            });

            new ARecord(this, "AliasRecord", new ARecordProps
            {
                Zone = hostedZone,
                RecordName = props.DomainName,
                Target = RecordTarget.FromAlias(new CloudFrontTarget(distribution))
            });
        }

        // ── Tags ─────────────────────────────────────────────────────────
        Amazon.CDK.Tags.Of(this).Add("Project", "note-taker");

        // ── Outputs ──────────────────────────────────────────────────────
        new CfnOutput(this, "ApiUrl", new CfnOutputProps
        {
            Value = !string.IsNullOrEmpty(props.DomainName)
                ? $"https://{props.DomainName}/api"
                : $"https://{distribution.DistributionDomainName}/api",
            Description = "API endpoint URL"
        });

        new CfnOutput(this, "WebBucketName", new CfnOutputProps
        {
            Value = webBucket.BucketName,
            Description = "S3 bucket for web assets"
        });

        new CfnOutput(this, "WebUrl", new CfnOutputProps
        {
            Value = !string.IsNullOrEmpty(props.DomainName)
                ? $"https://{props.DomainName}"
                : $"https://{distribution.DistributionDomainName}",
            Description = "Frontend URL"
        });

        new CfnOutput(this, "DistributionId", new CfnOutputProps
        {
            Value = distribution.DistributionId,
            Description = "CloudFront distribution ID (used for cache invalidation on deploy)"
        });

        // ── Ops dashboard ────────────────────────────────────────────────
        // One pinned place to answer "is it healthy / what broke / why slow".
        // The errors widget is a Logs Insights query so its time-range picker
        // drives "how far back"; the metric widgets read Lambda/DynamoDB plus the
        // NoteTaker/Domain EMF metrics emitted in 12-B.
        var dashboard = new Amazon.CDK.AWS.CloudWatch.Dashboard(this, "OpsDashboard", new Amazon.CDK.AWS.CloudWatch.DashboardProps
        {
            DashboardName = "notetaker-ops"
        });

        // Domain metrics (12-B) are emitted with dimensions — CommandType/Aggregate
        // plus a "Service" dimension that Powertools adds from the service: argument,
        // not from the dimensions dict. A dimensionless query reads nothing, and a
        // fixed dimension schema is brittle (must list every key, Service included).
        // A free-text SEARCH on namespace+name matches every dimension combination;
        // SUM collapses them into one total line.
        Amazon.CDK.AWS.CloudWatch.IMetric DomainTotal(string metricName) =>
            new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
            {
                Expression = $"SUM(SEARCH('Namespace=\"NoteTaker/Domain\" MetricName=\"{metricName}\"', 'Sum'))",
                Label = metricName,
                Period = Duration.Minutes(5)
            });

        dashboard.AddWidgets(
            new Amazon.CDK.AWS.CloudWatch.LogQueryWidget(new Amazon.CDK.AWS.CloudWatch.LogQueryWidgetProps
            {
                Title = "All errors",
                LogGroupNames = new[] { apiLogGroup.LogGroupName },
                Width = 24,
                Height = 6,
                View = Amazon.CDK.AWS.CloudWatch.LogQueryVisualizationType.TABLE,
                // level literals match Powertools' casing ("Error"/"Warning"); the
                // @message regex is the fallback that catches anything else.
                QueryString = string.Join("\n",
                    "fields @timestamp, level, xray_trace_id, message, @message",
                    "| filter level in [\"Error\", \"Warning\"] or @message like /(?i)exception|error|fail/",
                    "| sort @timestamp desc",
                    "| limit 100")
            }),
            // Function-level metrics aggregate across versions/aliases — the right
            // granularity for an ops overview, deliberately not alias-scoped.
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Lambda errors & invocations",
                Left = new[] { apiFunction.MetricErrors(), apiFunction.MetricInvocations() },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Lambda duration p50/p99",
                Left = new[]
                {
                    apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p50" }),
                    apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "p99" })
                },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Event store DynamoDB write capacity & errors",
                Left = new[] { eventsTable.MetricConsumedWriteCapacityUnits() },
                Right = new[] { eventsTable.MetricSystemErrorsForOperations() },
                Width = 12
            }),
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Commands handled vs concurrency conflicts",
                Left = new[]
                {
                    DomainTotal("CommandHandled"),
                    DomainTotal("ConcurrencyConflict")
                },
                Width = 12
            }));

        new CfnOutput(this, "DashboardUrl", new CfnOutputProps
        {
            Value = $"https://{Region}.console.aws.amazon.com/cloudwatch/home?region={Region}#dashboards:name=notetaker-ops",
            Description = "CloudWatch ops dashboard URL"
        });

        // ── Frontend monitoring (CloudWatch RUM) ─────────────────────────
        // RUM captures JS errors, Core Web Vitals, and failed API calls from
        // real browsers, and (EnableXRay) links a frontend error to its backend
        // trace via the trace id propagated in 12-C. The browser RUM client is
        // anonymous, so it needs temporary AWS creds to call rum:PutRumEvents.
        // CfnAppMonitor does NOT auto-create the Cognito pool/guest-role that the
        // console wizard creates, so we wire them explicitly.
        var rumDomain = !string.IsNullOrEmpty(props.DomainName)
            ? props.DomainName
            : distribution.DistributionDomainName;

        // Used as both the AppMonitor name and the ResourceName the guest-role
        // ARN is built from; the two must stay identical or the role grants
        // rum:PutRumEvents on the wrong ARN and RUM silently drops events.
        const string rumMonitorName = "notetaker-rum";

        var rumIdentityPool = new CfnIdentityPool(this, "RumIdentityPool", new CfnIdentityPoolProps
        {
            AllowUnauthenticatedIdentities = true
        });

        // The guest role's policy references the monitor ARN and the monitor
        // references the role ARN — a cycle. Break it by building the ARN from
        // the fixed monitor name rather than from the L1 attribute.
        var rumMonitorArn = Arn.Format(new ArnComponents
        {
            Service = "rum",
            Resource = "appmonitor",
            ResourceName = rumMonitorName
        }, this);

        var rumGuestRole = new Role(this, "RumGuestRole", new RoleProps
        {
            Description = "Unauthenticated Cognito role allowing the browser RUM client to PutRumEvents",
            AssumedBy = new FederatedPrincipal(
                "cognito-identity.amazonaws.com",
                new Dictionary<string, object>
                {
                    ["StringEquals"] = new Dictionary<string, object>
                    {
                        ["cognito-identity.amazonaws.com:aud"] = rumIdentityPool.Ref
                    },
                    ["ForAnyValue:StringLike"] = new Dictionary<string, object>
                    {
                        ["cognito-identity.amazonaws.com:amr"] = "unauthenticated"
                    }
                },
                "sts:AssumeRoleWithWebIdentity"),
            InlinePolicies = new Dictionary<string, PolicyDocument>
            {
                ["RumPutEvents"] = new PolicyDocument(new PolicyDocumentProps
                {
                    Statements = new[]
                    {
                        new PolicyStatement(new PolicyStatementProps
                        {
                            Actions = new[] { "rum:PutRumEvents" },
                            Resources = new[] { rumMonitorArn }
                        })
                    }
                })
            }
        });

        new CfnIdentityPoolRoleAttachment(this, "RumIdentityPoolRoleAttachment", new CfnIdentityPoolRoleAttachmentProps
        {
            IdentityPoolId = rumIdentityPool.Ref,
            Roles = new Dictionary<string, object>
            {
                ["unauthenticated"] = rumGuestRole.RoleArn
            }
        });

        var rumAppMonitor = new CfnAppMonitor(this, "RumAppMonitor", new CfnAppMonitorProps
        {
            Name = rumMonitorName,
            Domain = rumDomain,
            CwLogEnabled = true,
            AppMonitorConfiguration = new CfnAppMonitor.AppMonitorConfigurationProperty
            {
                AllowCookies = true,
                EnableXRay = true,
                // Learning project: capture every session. Lower this in real prod for cost.
                SessionSampleRate = 1.0,
                Telemetries = new[] { "errors", "performance", "http" },
                IdentityPoolId = rumIdentityPool.Ref,
                GuestRoleArn = rumGuestRole.RoleArn
            }
        });

        // AttrId is the generated AppMonitor GUID the browser snippet needs;
        // Ref would return the monitor name and RUM would silently drop events.
        new CfnOutput(this, "RumMonitorId", new CfnOutputProps
        {
            Value = rumAppMonitor.AttrId,
            Description = "CloudWatch RUM AppMonitor ID (injected into index.html at deploy time)"
        });

        new CfnOutput(this, "RumIdentityPoolId", new CfnOutputProps
        {
            Value = rumIdentityPool.Ref,
            Description = "Cognito identity pool ID for the browser RUM client"
        });

        // ── Alarms + SNS notifications ───────────────────────────────────
        // Turns the ops dashboard from something you remember to check into
        // something that emails you. One topic, three alarms (error rate, P99
        // latency, concurrency-conflict spikes), each wired via an SnsAction.
        // The email address is the only environment-specific value — kept in a
        // single const so it is easy to change.
        const string alarmEmail = "simon.kirkham+note-taker-ai@gmail.com";

        var alarmsTopic = new Amazon.CDK.AWS.SNS.Topic(this, "AlarmsTopic", new Amazon.CDK.AWS.SNS.TopicProps
        {
            TopicName = "notetaker-alarms"
        });
        alarmsTopic.AddSubscription(new Amazon.CDK.AWS.SNS.Subscriptions.EmailSubscription(alarmEmail));

        var alarmAction = new Amazon.CDK.AWS.CloudWatch.Actions.SnsAction(alarmsTopic);

        // Error rate as a percentage of invocations, computed at the alarm so a
        // burst of errors against low traffic still trips. NOT_BREACHING keeps
        // the alarm OK during idle windows where no invocations are recorded.
        var errorRate = new Amazon.CDK.AWS.CloudWatch.MathExpression(new Amazon.CDK.AWS.CloudWatch.MathExpressionProps
        {
            Expression = "errors / invocations * 100",
            UsingMetrics = new Dictionary<string, Amazon.CDK.AWS.CloudWatch.IMetric>
            {
                ["errors"] = apiFunction.MetricErrors(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" }),
                ["invocations"] = apiFunction.MetricInvocations(new Amazon.CDK.AWS.CloudWatch.MetricOptions { Statistic = "Sum" })
            },
            Label = "Error rate (%)",
            Period = Duration.Minutes(5)
        });

        var errorRateAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ErrorRateAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-error-rate",
            AlarmDescription = "Lambda error rate exceeds 1% over 5 minutes",
            Metric = errorRate,
            Threshold = 1,
            EvaluationPeriods = 2,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        errorRateAlarm.AddAlarmAction(alarmAction);

        var latencyAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "LatencyAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-p99-latency",
            AlarmDescription = "Lambda P99 duration exceeds 5000 ms over 5 minutes",
            Metric = apiFunction.MetricDuration(new Amazon.CDK.AWS.CloudWatch.MetricOptions
            {
                Statistic = "p99",
                Period = Duration.Minutes(5)
            }),
            Threshold = 5000,
            EvaluationPeriods = 2,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        latencyAlarm.AddAlarmAction(alarmAction);

        // ── Backend canary deploy + automated rollback (26-C) ─────────────
        // Shift the `live` alias to a new version gradually instead of an instant 100%
        // cutover, and auto-roll-back if the error-rate or p99-latency alarm trips during
        // the bake. SnapStart publishes a new version each deploy; CodeDeploy shifts the
        // alias from the old published version to the new one (SnapStart restore happens
        // on the new version before traffic moves). CANARY_10PERCENT_5MINUTES keeps the
        // bake short — 10% for 5 minutes, then 100% — which suits a low-traffic app where
        // a longer linear shift only delays every deploy. The alarms are the same ones the
        // ops dashboard already uses; they keep evaluating post-shift, not just during it.
        // NOTE: an alarm needs traffic to evaluate, so on an idle deploy the canary simply
        // completes with nothing to trip it (no false rollback, but also no real bake).
        new Amazon.CDK.AWS.CodeDeploy.LambdaDeploymentGroup(this, "ApiCanaryDeploymentGroup", new Amazon.CDK.AWS.CodeDeploy.LambdaDeploymentGroupProps
        {
            Alias = apiAlias,
            DeploymentConfig = Amazon.CDK.AWS.CodeDeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
            Alarms = new[] { errorRateAlarm, latencyAlarm }
        });

        // Projection-rebuild operability (24-C). Both metrics carry only the Powertools
        // Service dimension, so each is a single concrete metric an alarm can target (no
        // SEARCH). A fault means a partial/failed rebuild — degraded read models until a
        // clean re-run — so any occurrence pages. Duration warns when a rebuild creeps
        // toward the 29s HTTP limit (the trigger to move it off the request path).
        var rebuildFaultAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectionRebuildFaultAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projection-rebuild-fault",
            AlarmDescription = "A projection rebuild faulted (partial/failed rebuild) in the last 5 minutes",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ProjectionRebuildFault",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 0,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        rebuildFaultAlarm.AddAlarmAction(alarmAction);

        var rebuildDurationAlarm = new Amazon.CDK.AWS.CloudWatch.Alarm(this, "ProjectionRebuildDurationAlarm", new Amazon.CDK.AWS.CloudWatch.AlarmProps
        {
            AlarmName = "notetaker-projection-rebuild-duration",
            AlarmDescription = "Projection rebuild duration exceeds 20s, approaching the 29s HTTP limit",
            Metric = new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "NoteTaker/Domain",
                MetricName = "ProjectionRebuildDuration",
                DimensionsMap = new Dictionary<string, string> { ["Service"] = "note-taker" },
                Statistic = "Maximum",
                Period = Duration.Minutes(5)
            }),
            Threshold = 20000,
            EvaluationPeriods = 1,
            ComparisonOperator = Amazon.CDK.AWS.CloudWatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            TreatMissingData = Amazon.CDK.AWS.CloudWatch.TreatMissingData.NOT_BREACHING
        });
        rebuildDurationAlarm.AddAlarmAction(alarmAction);

        // NOTE: a concurrency-conflict alarm is deliberately NOT defined here.
        // ConcurrencyConflict is emitted with per-Aggregate dimensions (plus the
        // Powertools Service dimension), so the only way to aggregate across all
        // aggregates is SUM(SEARCH(...)) — and CloudWatch rejects SEARCH on metric
        // alarms ("SEARCH is not supported on Metric Alarms"). Alarming on it
        // requires first emitting an alarmable (dimensionless or Service-only)
        // ConcurrencyConflict metric; deferred to a follow-up. See phase-12 12-E.

        // ── Unified error view (12-H) ────────────────────────────────────
        // Bring the browser's errors onto the same ops dashboard as the Lambda
        // errors, so one screen (with one time-range picker) answers "what's
        // broken?" across the whole stack. Added as a second AddWidgets call
        // here because rumAppMonitor does not exist when the first batch runs.
        //
        // RUM (CwLogEnabled = true) auto-creates its log group as
        // /aws/vendedlogs/RUMService_notetaker-rum<first-8-of-monitor-GUID>.
        // That suffix is the first hyphen-segment of the monitor GUID, so the
        // name is derivable from AttrId — no hard-coding the environment-specific ID.
        var rumLogGroupName = $"/aws/vendedlogs/RUMService_{rumMonitorName}{Fn.Select(0, Fn.Split("-", rumAppMonitor.AttrId))}";

        // Default RUM metrics publish to AWS/RUM automatically once traffic flows
        // (no CfnMetricsDestination needed); the widget reads whatever RUM emits.
        Amazon.CDK.AWS.CloudWatch.IMetric RumErrorMetric(string metricName) =>
            new Amazon.CDK.AWS.CloudWatch.Metric(new Amazon.CDK.AWS.CloudWatch.MetricProps
            {
                Namespace = "AWS/RUM",
                MetricName = metricName,
                DimensionsMap = new Dictionary<string, string> { ["application_name"] = rumMonitorName },
                Statistic = "Sum",
                Period = Duration.Minutes(5)
            });

        dashboard.AddWidgets(
            new Amazon.CDK.AWS.CloudWatch.GraphWidget(new Amazon.CDK.AWS.CloudWatch.GraphWidgetProps
            {
                Title = "Frontend errors (RUM)",
                Left = new[]
                {
                    RumErrorMetric("JsErrorCount"),
                    RumErrorMetric("HttpErrorCount")
                },
                Width = 12
            }),
            // Single combined "all errors" table over BOTH log groups. The two
            // sources have different shapes: Powertools backend lines carry
            // level/xray_trace_id/message; RUM events are JSON with the event
            // type com.amazon.rum.js_error_event and the message under
            // event_details. The query matches both with an `or` and surfaces a
            // unified field set, newest first. Time-range picker drives "how far back".
            new Amazon.CDK.AWS.CloudWatch.LogQueryWidget(new Amazon.CDK.AWS.CloudWatch.LogQueryWidgetProps
            {
                Title = "All errors (backend + frontend)",
                LogGroupNames = new[] { apiLogGroup.LogGroupName, rumLogGroupName },
                Width = 24,
                Height = 6,
                View = Amazon.CDK.AWS.CloudWatch.LogQueryVisualizationType.TABLE,
                QueryString = string.Join("\n",
                    "fields @timestamp, level, xray_trace_id, message, event_details.message, @message",
                    "| filter level in [\"Error\", \"Warning\"] or @message like /com.amazon.rum.js_error_event/ or @message like /(?i)exception|error|fail/",
                    "| sort @timestamp desc",
                    "| limit 100")
            }));

        // ── Saved Logs Insights queries (12-G) ───────────────────────────
        // Persist the runbook's most-used queries so they appear in everyone's
        // Logs Insights query picker under the "NoteTaker/" folder. Field names
        // match the Powertools log shape verified in prod: level / message /
        // xray_trace_id / command_type / stream_id (Powertools emits snake_case).
        // (There is no correlationId log
        // field — x-correlation-id is only a response header; the queryable
        // per-request key is xray_trace_id, set by X-Ray in 12-C.)
        // The "Concurrency conflicts" filter matches the warning the event-store
        // decorator logs ("Concurrency conflict {StreamId} ..."). See docs/observability.md.
        void SavedQuery(string id, string name, string query) =>
            new Amazon.CDK.AWS.Logs.CfnQueryDefinition(this, id, new Amazon.CDK.AWS.Logs.CfnQueryDefinitionProps
            {
                Name = name,
                LogGroupNames = new[] { apiLogGroup.LogGroupName },
                QueryString = query
            });

        SavedQuery("QueryAllErrors", "NoteTaker/All errors", string.Join("\n",
            "fields @timestamp, level, xray_trace_id, command_type, stream_id, message, @message",
            "| filter level in [\"Error\", \"Warning\"] or @message like /(?i)exception|error|fail/",
            "| sort @timestamp desc",
            "| limit 100"));

        SavedQuery("QueryByTraceId", "NoteTaker/By trace ID", string.Join("\n",
            "fields @timestamp, level, command_type, stream_id, message",
            // Replace the placeholder with the trace id — the Root=1-... value from the
            // x-amzn-trace-id response header (it appears in logs as xray_trace_id).
            "| filter xray_trace_id = \"REPLACE_WITH_XRAY_TRACE_ID\"",
            "| sort @timestamp asc"));

        SavedQuery("QuerySlowestRequests", "NoteTaker/Slowest requests", string.Join("\n",
            // The Lambda REPORT line carries @duration; for per-command/subsegment
            // latency use X-Ray (ReadEvents/AppendEvents subsegments) instead.
            "filter @type = \"REPORT\"",
            "| sort @duration desc",
            "| limit 20",
            "| fields @timestamp, @duration, @billedDuration, @maxMemoryUsed, @requestId"));

        SavedQuery("QueryConcurrencyConflicts", "NoteTaker/Concurrency conflicts", string.Join("\n",
            "fields @timestamp, stream_id, @message",
            "| filter message like /Concurrency conflict/",
            "| sort @timestamp desc",
            "| limit 100"));
    }

    private DistributionProps BuildDistributionProps(
        NoteTakerStackProps props,
        Amazon.CDK.AWS.Apigatewayv2.HttpApi httpApi,
        Bucket webBucket)
    {
        // Rewrite SPA paths (no file extension in last segment) to /index.html at the edge.
        // Scoped to the default S3 behavior so API 404s pass through to the caller unchanged.
        var spaRoutingFunction = new Amazon.CDK.AWS.CloudFront.Function(this, "SpaRoutingFunction",
            new Amazon.CDK.AWS.CloudFront.FunctionProps
            {
                Code = FunctionCode.FromInline("""
                    function handler(event) {
                        var request = event.request;
                        var uri = request.uri;
                        if (uri.lastIndexOf('.') < uri.lastIndexOf('/')) {
                            request.uri = '/index.html';
                        }
                        return request;
                    }
                    """),
                Runtime = FunctionRuntime.JS_2_0
            });

        var defaultBehavior = new BehaviorOptions
        {
            Origin = S3BucketOrigin.WithOriginAccessControl(webBucket),
            FunctionAssociations = new[]
            {
                new FunctionAssociation
                {
                    Function = spaRoutingFunction,
                    EventType = FunctionEventType.VIEWER_REQUEST
                }
            }
        };

        // Strip /api prefix before forwarding to API Gateway
        var apiStripFunction = new Amazon.CDK.AWS.CloudFront.Function(this, "ApiStripFunction",
            new Amazon.CDK.AWS.CloudFront.FunctionProps
            {
                Code = FunctionCode.FromInline("""
                    function handler(event) {
                        var request = event.request;
                        var prefix = '/api'; // strip CloudFront behaviour prefix before forwarding
                        request.uri = request.uri.slice(prefix.length) || '/';
                        return request;
                    }
                    """),
                Runtime = FunctionRuntime.JS_2_0
            });

        // API Gateway hostname extracted from its endpoint URL (https://id.execute-api.region.amazonaws.com)
        var apiHostname = Fn.Select(2, Fn.Split("/", httpApi.ApiEndpoint));

        var additionalBehaviors = new Dictionary<string, IBehaviorOptions>
        {
            ["/api/*"] = new BehaviorOptions
            {
                Origin = new HttpOrigin(apiHostname),
                AllowedMethods = AllowedMethods.ALLOW_ALL,
                CachePolicy = CachePolicy.CACHING_DISABLED,
                OriginRequestPolicy = OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                FunctionAssociations = new[]
                {
                    new FunctionAssociation
                    {
                        Function = apiStripFunction,
                        EventType = FunctionEventType.VIEWER_REQUEST
                    }
                }
            }
        };

        if (string.IsNullOrEmpty(props.CertificateArn) || string.IsNullOrEmpty(props.DomainName))
        {
            return new DistributionProps
            {
                DefaultBehavior = defaultBehavior,
                DefaultRootObject = "index.html",
                AdditionalBehaviors = additionalBehaviors
            };
        }

        return new DistributionProps
        {
            DefaultBehavior = defaultBehavior,
            DefaultRootObject = "index.html",
            DomainNames = new[] { props.DomainName },
            Certificate = Certificate.FromCertificateArn(this, "Certificate", props.CertificateArn),
            AdditionalBehaviors = additionalBehaviors
        };
    }

}
