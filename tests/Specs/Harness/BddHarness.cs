namespace Specs.Harness;

/// <summary>
/// Marker interface for domain events carried through the harness.
/// </summary>
public interface IDomainEvent { }

/// <summary>
/// Marker interface for commands passed to aggregates.
/// </summary>
public interface ICommand { }

/// <summary>
/// Minimal aggregate contract the harness drives.
/// </summary>
public interface IAggregate
{
    /// <summary>Apply prior events to rebuild state before issuing a command.</summary>
    void Apply(IDomainEvent @event);

    /// <summary>Handle a command and return the resulting events.</summary>
    IReadOnlyList<IDomainEvent> Handle(ICommand command);
}

// ---------------------------------------------------------------------------
// Fluent builder entry point
// ---------------------------------------------------------------------------

/// <summary>
/// Entry point for the fluent Given/When/Then builder.
/// </summary>
public static class Spec
{
    public static WhenBuilder<TAggregate> Given<TAggregate>(
        params IDomainEvent[] priorEvents)
        where TAggregate : IAggregate, new()
        => new WhenBuilder<TAggregate>(priorEvents);
}

public sealed class WhenBuilder<TAggregate>
    where TAggregate : IAggregate, new()
{
    private readonly IReadOnlyList<IDomainEvent> _priorEvents;

    internal WhenBuilder(IReadOnlyList<IDomainEvent> priorEvents)
        => _priorEvents = priorEvents;

    public ThenBuilder<TAggregate> When(ICommand command)
        => new ThenBuilder<TAggregate>(_priorEvents, command);
}

public sealed class ThenBuilder<TAggregate>
    where TAggregate : IAggregate, new()
{
    private readonly IReadOnlyList<IDomainEvent> _priorEvents;
    private readonly ICommand _command;

    internal ThenBuilder(IReadOnlyList<IDomainEvent> priorEvents, ICommand command)
    {
        _priorEvents = priorEvents;
        _command = command;
    }

    /// <summary>
    /// Assert that the aggregate produces exactly <paramref name="expectedEvents"/>
    /// in response to the command.
    /// </summary>
    public void Then(params IDomainEvent[] expectedEvents)
    {
        var aggregate = new TAggregate();
        foreach (var e in _priorEvents)
            aggregate.Apply(e);

        IReadOnlyList<IDomainEvent> actual;
        try
        {
            actual = aggregate.Handle(_command);
        }
        catch (Exception ex)
        {
            throw new Xunit.Sdk.XunitException(
                $"Expected events but aggregate threw {ex.GetType().Name}: {ex.Message}");
        }

        Assert.Equal(expectedEvents, actual);
    }

    /// <summary>
    /// Assert that the aggregate throws <typeparamref name="TException"/>
    /// in response to the command.
    /// </summary>
    public void ThenThrows<TException>() where TException : Exception
    {
        var aggregate = new TAggregate();
        foreach (var e in _priorEvents)
            aggregate.Apply(e);

        Assert.Throws<TException>(() => aggregate.Handle(_command));
    }
}
