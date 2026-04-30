using Amazon.CDK;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.DynamoDB;
using Amazon.CDK.AWS.S3;
using Constructs;

public class NoteTakerStack : Stack
{
    internal NoteTakerStack(Construct scope, string id, IStackProps props) : base(scope, id, props)
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

        // ── Projection table ─────────────────────────────────────────────
        var projTable = new Table(this, "ProjNoteTitleListTable", new TableProps
        {
            TableName = "notetaker-proj-notetitlelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        // ── API Lambda ───────────────────────────────────────────────────
        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_8,
            Handler = "Api",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset("src/Api/bin/Release/net8.0/publish"),
            Environment = new Dictionary<string, string>
            {
                ["EVENTS_TABLE_NAME"] = eventsTable.TableName,
                ["PROJ_NOTETITLELIST_TABLE_NAME"] = projTable.TableName
            }
        });

        eventsTable.GrantReadWriteData(apiFunction);
        projTable.GrantReadWriteData(apiFunction);

        // ── API Gateway ──────────────────────────────────────────────────
        var httpApi = new Amazon.CDK.AWS.Apigatewayv2.HttpApi(this, "HttpApi", new Amazon.CDK.AWS.Apigatewayv2.HttpApiProps
        {
            ApiName = "notetaker-api",
            CorsPreflight = new Amazon.CDK.AWS.Apigatewayv2.CorsPreflightOptions
            {
                AllowOrigins = new[] { "*" },
                AllowMethods = new[] { Amazon.CDK.AWS.Apigatewayv2.CorsHttpMethod.ANY },
                AllowHeaders = new[] { "content-type" }
            }
        });

        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.ANY },
            Integration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
                "LambdaIntegration", apiFunction)
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
