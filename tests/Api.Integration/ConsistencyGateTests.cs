using Api.Consistency;
using EventStore.Projections;

namespace Api.Integration;

// RYW-1 consistency gate: parse the If-Consistent-With token and bounded-poll the processed-
// position store until the stream's applied sequence reaches the requested version. The poll
// interval, cap, and delay func are injected so these tests advance virtual time, not the wall
// clock — no test sleeps the real 8s bound.
public sealed class ConsistencyGateTests
{
    private const string Stream = "todo#abc";

    // Inject the SAME interval/cap the production default constructor uses (50ms / 8000ms) with a
    // virtual-time delay, so these tests exercise real production timing without sleeping the 8s bound.
    private static ConsistencyGate Gate(IProcessedPositionStore positions, Func<TimeSpan, CancellationToken, Task> delay) =>
        new(positions, ConsistencyGate.DefaultPollInterval, ConsistencyGate.DefaultCap, delay);

    // BUG-31 guard: the production cap must stay at 8s so a fresh read tolerates the ~7s projector
    // cold start. A drop back to 2s would re-break read-your-writes after an idle gap.
    [Fact]
    public void Production_defaults_are_50ms_poll_and_8s_cap()
    {
        Assert.Equal(TimeSpan.FromMilliseconds(50), ConsistencyGate.DefaultPollInterval);
        Assert.Equal(TimeSpan.FromMilliseconds(8000), ConsistencyGate.DefaultCap);
    }

    // BUG-31: a projector that only catches up at ~7s (a cold start) must still return Fresh under the
    // 8s cap — the exact case the old 2s cap failed. 7000ms / 50ms = catches up on the 140th poll.
    [Fact]
    public async Task Cold_projector_catching_up_at_7s_returns_Fresh_under_the_8s_cap()
    {
        var positions = new InMemoryProcessedPositionStore();
        var polls = 0;
        Func<TimeSpan, CancellationToken, Task> delay = async (_, _) =>
        {
            polls++;
            if (polls == 140) await positions.SetLastSeqAsync(Stream, 3);
        };

        var result = await Gate(positions, delay).WaitAsync($"{Stream}@3");

        Assert.Equal(ConsistencyOutcome.Fresh, result.Outcome);
        Assert.Equal(140, polls);
    }

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
        // 8000ms cap / 50ms interval = 160 polls before the cap is reached.
        Assert.Equal(160, polls);
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

    // WaitForPresenceAsync: the cross-stream existence wait. Same interval/cap/delay as the version
    // wait, but polls a read func until it returns non-null (a projection row lagging a DIFFERENT
    // stream than the token gated on) — returns the value once present, or null once the cap elapses.

    [Fact]
    public async Task Presence_present_immediately_returns_value_without_delaying()
    {
        var positions = new InMemoryProcessedPositionStore();
        var delays = 0;
        var gate = Gate(positions, (_, _) => { delays++; return Task.CompletedTask; });

        var value = await gate.WaitForPresenceAsync(_ => Task.FromResult<string?>("note"));

        Assert.Equal("note", value);
        Assert.Equal(0, delays);
    }

    [Fact]
    public async Task Presence_appears_after_some_polls_returns_value()
    {
        var positions = new InMemoryProcessedPositionStore();
        var reads = 0;
        var gate = Gate(positions, (_, _) => Task.CompletedTask);

        // null on the first two reads, present on the third.
        var value = await gate.WaitForPresenceAsync(_ =>
        {
            reads++;
            return Task.FromResult<string?>(reads >= 3 ? "note" : null);
        });

        Assert.Equal("note", value);
        Assert.Equal(3, reads);
    }

    [Fact]
    public async Task Presence_never_appears_returns_null_within_the_cap()
    {
        var positions = new InMemoryProcessedPositionStore();
        var polls = 0;
        var gate = Gate(positions, (_, _) => { polls++; return Task.CompletedTask; });

        var value = await gate.WaitForPresenceAsync(_ => Task.FromResult<string?>(null));

        Assert.Null(value);
        // 8000ms cap / 50ms interval = 160 polls before the cap is reached.
        Assert.Equal(160, polls);
    }
}
