using Amazon.CDK;
using Amazon.CDK.AWS.DynamoDB;
using Constructs;

public class NoteTakerStack : Stack
{
    internal NoteTakerStack(Construct scope, string id, IStackProps props) : base(scope, id, props)
    {
        var eventsTable = new Table(this, "EventsTable", new TableProps
        {
            TableName = "notetaker-events",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            SortKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "SK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

        var projTable = new Table(this, "ProjNoteTitleListTable", new TableProps
        {
            TableName = "notetaker-proj-notetitlelist",
            PartitionKey = new Amazon.CDK.AWS.DynamoDB.Attribute { Name = "PK", Type = AttributeType.STRING },
            BillingMode = BillingMode.PAY_PER_REQUEST,
            RemovalPolicy = RemovalPolicy.RETAIN
        });

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

        var httpApi = new Amazon.CDK.AWS.Apigatewayv2.HttpApi(this, "HttpApi", new Amazon.CDK.AWS.Apigatewayv2.HttpApiProps
        {
            ApiName = "notetaker-api"
        });

        httpApi.AddRoutes(new Amazon.CDK.AWS.Apigatewayv2.AddRoutesOptions
        {
            Path = "/{proxy+}",
            Methods = new[] { Amazon.CDK.AWS.Apigatewayv2.HttpMethod.ANY },
            Integration = new Amazon.CDK.AwsApigatewayv2Integrations.HttpLambdaIntegration(
                "LambdaIntegration", apiFunction)
        });

        Amazon.CDK.Tags.Of(this).Add("Project", "note-taker");

        new CfnOutput(this, "ApiUrl", new CfnOutputProps
        {
            Value = httpApi.ApiEndpoint,
            Description = "API Gateway endpoint URL"
        });
    }
}
