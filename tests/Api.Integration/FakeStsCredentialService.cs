using Api.Services;

namespace Api.Integration;

public sealed class FakeStsCredentialService : IStsCredentialService
{
    public static readonly TemporaryCredentials FakeCredentials = new(
        AccessKeyId: "ASIATESTFAKEKEY",
        SecretAccessKey: "fakeSecretAccessKey",
        SessionToken: "fakeSessionToken",
        Expiration: DateTimeOffset.UtcNow.AddMinutes(15)
    );

    public bool WasCalled { get; private set; }

    public Task<TemporaryCredentials> AssumeTranscribeRoleAsync()
    {
        WasCalled = true;
        return Task.FromResult(FakeCredentials);
    }
}
