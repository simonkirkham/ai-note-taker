// CDK entry point. The CDK stack will be implemented here.
using Amazon.CDK;

var app = new App();

  new NoteTakerStack(app, "NoteTakerStack", new StackProps {                                                                                                   
      Env = new Amazon.CDK.Environment {                                                                                                                       
          Account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT"),
          Region  = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_REGION")  
      }                                                                                                                                                        
  });  


app.Synth();
