using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53.Targets;
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

        // ── API Lambda ───────────────────────────────────────────────────
        var lambdaAssetPath = (string?)this.Node.TryGetContext("lambdaAssetPath")
            ?? "src/Api/bin/Release/net10.0/publish";
        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Api",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(lambdaAssetPath),
            Timeout = Duration.Seconds(29),
            MemorySize = 512,
            SnapStart = Amazon.CDK.AWS.Lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
            Environment = new Dictionary<string, string>
            {
                ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
                ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName,
                ["PROJ_NOTEDETAIL_TABLE_NAME"] = noteDetailTable.TableName,
                ["PROJ_NOTEACTIONS_TABLE_NAME"] = noteActionsTable.TableName,
                ["PROJ_TODOLIST_TABLE_NAME"] = todoListTable.TableName,
                ["PROJ_NOTECARDLIST_TABLE_NAME"] = noteCardListTable.TableName,
                ["PROJ_FOLDERTREE_TABLE_NAME"] = folderTreeTable.TableName,
                ["PROJ_TAGINDEX_TABLE_NAME"] = tagIndexTable.TableName,
                // Always present even when unset so runtime code reads "" rather than throwing on missing key.
                // Use string.IsNullOrEmpty() on the consumer side; the key itself is always there.
                ["GOOGLE_CLIENT_ID"] = props.GoogleClientId ?? "",
                ["GOOGLE_CLIENT_SECRET"] = props.GoogleClientSecret ?? "",
                ["ALLOWED_USER_SUBS"] = props.AllowedUserSubs ?? "",
                ["GOOGLE_REFRESH_TOKEN_SSM_PATH"] = props.GoogleRefreshTokenSsmPath ?? "",
                ["PROJ_CALENDARLINKINDEX_TABLE_NAME"] = calendarLinkIndexTable.TableName,
                ["BEDROCK_MODEL_ID"] = props.BedrockModelId ?? "",
                // Always present even when unset; overridden below once the role ARN is known.
                ["TRANSCRIBE_ROLE_ARN"] = ""
            }
        });

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
        calendarLinkIndexTable.GrantReadWriteData(apiFunction);

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

        // ── Transcribe browser role ──────────────────────────────────────
        // Scoped role the Lambda issues to the browser via STS AssumeRole.
        // Trust policy allows only this Lambda's execution role to assume it.
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
            AutoDeleteObjects = false
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
