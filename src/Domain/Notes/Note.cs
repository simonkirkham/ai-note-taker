namespace Domain.Notes;

public sealed class Note : IAggregate
{
    public void Apply(IDomainEvent @event) =>
        throw new NotImplementedException();

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        throw new NotImplementedException();
}
