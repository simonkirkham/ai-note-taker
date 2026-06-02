using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Api.Integration;

// BUG-3: ASP.NET Data Protection emitted three Warning lines per Lambda cold start
// about its ephemeral, unencrypted, in-memory key ring. This API authenticates with
// bearer tokens only (no cookies, antiforgery, or IDataProtector consumers), so Data
// Protection is unused and those warnings are pure noise that drowned out real errors
// on the ops dashboard. They are filtered out at source below Error level.
public sealed class DataProtectionLoggingTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private readonly ApiFactory _factory = factory;

    [Theory]
    [InlineData("Microsoft.AspNetCore.DataProtection")]
    [InlineData("Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager")]
    [InlineData("Microsoft.AspNetCore.DataProtection.Repositories.EphemeralXmlRepository")]
    public void DataProtectionCategory_IsSuppressedBelowError(string category)
    {
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger(category);

        Assert.False(logger.IsEnabled(LogLevel.Warning));
        Assert.True(logger.IsEnabled(LogLevel.Error));
    }

    [Fact]
    public void NonDataProtectionCategory_StillLogsWarnings()
    {
        // Guards that the filter is scoped to Data Protection and does not silence
        // warnings app-wide.
        var logger = _factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Api.Some.Component");

        Assert.True(logger.IsEnabled(LogLevel.Warning));
    }
}
