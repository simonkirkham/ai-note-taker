namespace Domain;

public interface IAggregate
{
    void Apply(IDomainEvent @event);
    IReadOnlyList<IDomainEvent> Handle(ICommand command);
}
