using Amazon.SecretsManager;
using Amazon.SecretsManager.Model;

namespace Api.Mcp.OAuth;

// Resolves the MCP HMAC signing secret VALUE from AWS Secrets Manager, given the secret NAME in the
// MCP_JWT_SECRET_NAME env var (the constructor dict carries the name, never the value). Fetched once
// at boot and cached. Returns "" when the name is unset or the fetch fails — the AS then refuses to
// mint and the RS refuses to validate (closed), rather than operating with no/blank key. NEVER logged.
public static class McpSigningSecretProvider
{
    public static string Resolve(IAmazonSecretsManager secrets, ILogger logger)
    {
        var secretName = Environment.GetEnvironmentVariable("MCP_JWT_SECRET_NAME");
        if (string.IsNullOrEmpty(secretName))
            return "";

        try
        {
            var response = secrets.GetSecretValueAsync(new GetSecretValueRequest { SecretId = secretName })
                .GetAwaiter().GetResult();
            return response.SecretString ?? "";
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to resolve MCP signing secret from Secrets Manager");
            return "";
        }
    }
}
