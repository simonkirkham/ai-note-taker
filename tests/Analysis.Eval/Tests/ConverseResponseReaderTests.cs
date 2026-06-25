using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;
using Api.Services;

namespace Analysis.Eval.Tests;

public class ConverseResponseReaderTests
{
    [Fact]
    public void Extracts_text_from_the_first_content_block()
    {
        var response = new ConverseResponse
        {
            Output = new ConverseOutput
            {
                Message = new Message
                {
                    Role = ConversationRole.Assistant,
                    Content = [new ContentBlock { Text = "hello world" }]
                }
            }
        };

        Assert.Equal("hello world", ConverseResponseReader.Text(response));
    }

    [Fact]
    public void Returns_empty_for_a_response_with_no_content()
    {
        Assert.Equal("", ConverseResponseReader.Text(new ConverseResponse()));
        Assert.Equal("", ConverseResponseReader.Text(new ConverseResponse
        {
            Output = new ConverseOutput { Message = new Message { Content = [] } }
        }));
    }
}
