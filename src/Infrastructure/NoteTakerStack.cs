using System;
using Amazon.CDK;
using Amazon.CDK.AWS.S3;
using Constructs;


public class NoteTakerStack : Stack
{
    internal NoteTakerStack(Construct scope, string id, IStackProps props = null) : base(scope, id, props)
    {
        var apiFunction = new Amazon.CDK.AWS.Lambda.Function(this, "ApiFunction", new Amazon.CDK.AWS.Lambda.FunctionProps
        {
            Runtime = Amazon.CDK.AWS.Lambda.Runtime.DOTNET_8,
            Handler = "Api",
            Code = Amazon.CDK.AWS.Lambda.Code.FromAsset("src/Api/bin/Release/net8.0/publish")
        });
    }
}
