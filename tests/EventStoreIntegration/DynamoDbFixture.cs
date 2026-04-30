using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Testcontainers.DynamoDb;

namespace EventStoreIntegration;

public sealed class DynamoDbFixture : IAsyncLifetime
{
    private readonly DynamoDbContainer _container = new DynamoDbBuilder().Build();

    public IAmazonDynamoDB DynamoDb { get; private set; } = null!;
    public string TableName { get; } = "test-events";

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        var config = new AmazonDynamoDBConfig { ServiceURL = _container.GetConnectionString() };
        DynamoDb = new AmazonDynamoDBClient("local", "local", config);

        await DynamoDb.CreateTableAsync(new CreateTableRequest
        {
            TableName = TableName,
            AttributeDefinitions =
            [
                new AttributeDefinition { AttributeName = "PK", AttributeType = ScalarAttributeType.S },
                new AttributeDefinition { AttributeName = "SK", AttributeType = ScalarAttributeType.S }
            ],
            KeySchema =
            [
                new KeySchemaElement { AttributeName = "PK", KeyType = KeyType.HASH },
                new KeySchemaElement { AttributeName = "SK", KeyType = KeyType.RANGE }
            ],
            BillingMode = BillingMode.PAY_PER_REQUEST
        });
    }

    public async Task DisposeAsync()
    {
        DynamoDb.Dispose();
        await _container.DisposeAsync();
    }
}
