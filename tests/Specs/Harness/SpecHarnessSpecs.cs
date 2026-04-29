namespace Specs.Harness;

// ---------------------------------------------------------------------------
// Inline synthetic aggregate — lives only in the test folder.
// Keeps the specs self-contained with no dependency on src/Domain/.
// ---------------------------------------------------------------------------

/// <summary>Command: create a widget with a given name.</summary>
public sealed record CreateWidget(string Name) : ICommand;

/// <summary>Event: a widget was created.</summary>
public sealed record WidgetCreated(string Name) : IDomainEvent;

/// <summary>Command: create a widget with an invalid (empty) name.</summary>
public sealed record CreateInvalidWidget() : ICommand;

/// <summary>
/// Minimal aggregate that handles <see cref="CreateWidget"/> and
/// <see cref="CreateInvalidWidget"/>. All real behaviour is intentionally
/// trivial — the aggregate exists only to exercise the harness.
/// </summary>
public sealed class TestAggregate : IAggregate
{
    public void Apply(IDomainEvent @event) { /* no state to rebuild */ }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            CreateWidget cmd => [new WidgetCreated(cmd.Name)],
            CreateInvalidWidget => throw new InvalidOperationException(
                "Widget name must not be empty."),
            _ => throw new ArgumentOutOfRangeException(
                nameof(command), "Unrecognised command.")
        };
}

/// <summary>
/// Specs for the BDD spec harness itself.
/// One class per command shape; one [Fact] per scenario.
/// </summary>
public sealed class SpecHarnessSpecs
{
    [Fact]
    public void HarnessAssertsExpectedEvents()
    {
        // A TestAggregate that receives CreateWidget should emit WidgetCreated.
        // The harness must compare the actual emitted events to the expected ones.
        Spec
            .Given<TestAggregate>()          // no prior events
            .When(new CreateWidget("Sprocket"))
            .Then(new WidgetCreated("Sprocket"));
    }

    [Fact]
    public void HarnessAssertsExpectedException()
    {
        // A TestAggregate that receives CreateInvalidWidget should throw.
        // The harness must catch the exception and assert its type.
        Spec
            .Given<TestAggregate>()          // no prior events
            .When(new CreateInvalidWidget())
            .ThenThrows<InvalidOperationException>();
    }
}
