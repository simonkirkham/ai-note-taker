using Api.Services;

namespace Api.Integration;

public sealed class FakeStsCredentialService : IStsCredentialService
{
    public static readonly TemporaryCredentials FakeCredentials = new(
        AccessKeyId: "ASIATESTFAKEKEY",
        SecretAccessKey: "fakeSecretAccessKey",
        SessionToken: "fakeSessionToken",
        Expiration: new DateTimeOffset(2099, 1, 1, 0, 0, 0, TimeSpan.Zero)
    );

    public bool WasCalled { get; private set; }

    public Task<TemporaryCredentials> AssumeTranscribeRoleAsync()
    {
        WasCalled = true;
        return Task.FromResult(FakeCredentials);
    }
}
