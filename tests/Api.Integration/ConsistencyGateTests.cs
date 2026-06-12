using Api.Consistency;
using EventStore.Projections;

namespace Api.Integration;

// RYW-1 consistency gate: parse the If-Consistent-With token and bounded-poll the processed-
// position store until the stream's applied sequence reaches the requested version. The poll
// interval, cap, and delay func are injected so these tests advance virtual time, not the wall
// clock — no test sleeps the real 2s bound.
public sealed class ConsistencyGateTests
{
    private const string Stream = "todo#abc";

    private static ConsistencyGate Gate(IProcessedPositionStore positions, Func<TimeSpan, CancellationToken, Task> delay) =>
        new(positions, TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(2000), delay);

    [Fact]
    public async Task Caught_up_returns_Fresh_immediately_without_delaying()
    {
        var positions = new InMemoryProcessedPositionStore();
        await positions.SetLastSeqAsync(Stream, 5);
        var delays = 0;

        var result = await Gate(positions, (_, _) => { delays++; return Task.CompletedTask; })
            .WaitAsync($"{Stream}@5");

        Assert.Equal(ConsistencyOutcome.Fresh, result.Outcome);
        Assert.Equal(0, delays);
    }

    [Fact]
    public async Task Advances_after_some_polls_waits_then_returns_Fresh()
    {
        var positions = new InMemoryProcessedPositionStore();
        var polls = 0;
        // The projector "applies" the write on the 3rd delay tick.
        Func<TimeSpan, CancellationToken, Task> delay = async (_, _) =>
        {
            polls++;
            if (polls == 3) await positions.SetLastSeqAsync(Stream, 7);
        };

        var result = await Gate(positions, delay).WaitAsync($"{Stream}@7");

        Assert.Equal(ConsistencyOutcome.Fresh, result.Outcome);
        Assert.Equal(3, polls);
    }

    [Fact]
    public async Task Never_advances_returns_Stale_within_the_cap()
    {
        var positions = new InMemoryProcessedPositionStore(); // stays at -1
        var polls = 0;

        var result = await Gate(positions, (_, _) => { polls++; return Task.CompletedTask; })
            .WaitAsync($"{Stream}@9");

        Assert.Equal(ConsistencyOutcome.Stale, result.Outcome);
        // 2000ms cap / 50ms interval = 40 polls before the cap is reached.
        Assert.Equal(40, polls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-at-sign")]
    [InlineData("todo#abc@")]
    [InlineData("todo#abc@notanumber")]
    [InlineData("@5")]
    public async Task Malformed_or_absent_token_returns_Proceed_without_polling(string? token)
    {
        var positions = new InMemoryProcessedPositionStore();
        var delays = 0;

        var result = await Gate(positions, (_, _) => { delays++; return Task.CompletedTask; }).WaitAsync(token);

        Assert.Equal(ConsistencyOutcome.Proceed, result.Outcome);
        Assert.Equal(0, delays);
    }

    [Fact]
    public async Task Stream_id_containing_at_splits_on_the_last_at()
    {
        var positions = new InMemoryProcessedPositionStore();
        await positions.SetLastSeqAsync("weird@stream", 2);

        var result = await Gate(positions, (_, _) => Task.CompletedTask).WaitAsync("weird@stream@2");

        Assert.Equal(ConsistencyOutcome.Fresh, result.Outcome);
    }
}
