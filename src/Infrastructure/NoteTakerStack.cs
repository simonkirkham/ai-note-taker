using System;
using Amazon.CDK;
using Amazon.CDK.AWS.S3;
using Constructs;


public class NoteTakerStack : Stack
{
    internal NoteTakerStack(Construct scope, string id, IStackProps props) : base(scope, id, props)
    {
        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_8,
            Handler = "Api",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset("src/Api/bin/Release/net8.0/publish")
        });

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

        new CfnOutput(this, "ApiUrl", new CfnOutputProps                                                                                       
        {                                                                                                                                      
            Value = httpApi.ApiEndpoint,
            Description = "API Gateway endpoint URL"                                                                                           
        });    
    }
}
