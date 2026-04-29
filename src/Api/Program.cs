// ASP.NET minimal API hosted in AWS Lambda.
// The Lambda entry point, CDK stack, and health endpoint will be implemented here.
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);

var app = builder.Build();

app.Run();
