using Amazon.CDK;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.S3;
using Constructs;

public class NoteTakerStack : Stack
{
    public NoteTakerStack(Construct scope, string id, IStackProps props) : base(scope, id, props)
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

        // ── API Lambda ───────────────────────────────────────────────────
        var lambdaAssetPath = (string?)this.Node.TryGetContext("lambdaAssetPath")
            ?? "src/Api/bin/Release/net10.0/publish";
        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_10,
            Handler = "Api",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset(lambdaAssetPath),
            Timeout = Duration.Seconds(29),
            SnapStart = Amazon.CDK.AWS.Lambda.SnapStartConf.ON_PUBLISHED_VERSIONS,
            Environment = new Dictionary<string, string>
            {
                ["EVENTS_TABLE_NAME"]            = eventsTable.TableName,
                ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName,
                ["PROJ_NOTEDETAIL_TABLE_NAME"]   = noteDetailTable.TableName,
                ["PROJ_NOTEACTIONS_TABLE_NAME"]  = noteActionsTable.TableName,
                ["PROJ_TODOLIST_TABLE_NAME"]     = todoListTable.TableName,
                ["PROJ_NOTECARDLIST_TABLE_NAME"] = noteCardListTable.TableName,
                ["PROJ_FOLDERTREE_TABLE_NAME"]   = folderTreeTable.TableName,
                ["PROJ_TAGINDEX_TABLE_NAME"]     = tagIndexTable.TableName
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

        var distribution = new Distribution(this, "WebDistribution", new DistributionProps
        {
            DefaultBehavior = new BehaviorOptions
            {
                Origin = S3BucketOrigin.WithOriginAccessControl(webBucket)
            },
            DefaultRootObject = "index.html",
            ErrorResponses = new[]
            {
                // Return index.html for 403/404 so React handles client-side routing
                new ErrorResponse { HttpStatus = 403, ResponseHttpStatus = 200, ResponsePagePath = "/index.html" },
                new ErrorResponse { HttpStatus = 404, ResponseHttpStatus = 200, ResponsePagePath = "/index.html" }
            }
        });

        // ── Tags ─────────────────────────────────────────────────────────
        Amazon.CDK.Tags.Of(this).Add("Project", "note-taker");

        // ── Outputs ──────────────────────────────────────────────────────
        new CfnOutput(this, "ApiUrl", new CfnOutputProps
        {
            Value = httpApi.ApiEndpoint,
            Description = "API Gateway endpoint URL"
        });

        new CfnOutput(this, "WebBucketName", new CfnOutputProps
        {
            Value = webBucket.BucketName,
            Description = "S3 bucket for web assets"
        });

        new CfnOutput(this, "WebUrl", new CfnOutputProps
        {
            Value = $"https://{distribution.DistributionDomainName}",
            Description = "CloudFront distribution URL"
        });

        new CfnOutput(this, "DistributionId", new CfnOutputProps
        {
            Value = distribution.DistributionId,
            Description = "CloudFront distribution ID (used for cache invalidation on deploy)"
        });
    }
}
