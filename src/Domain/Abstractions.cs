namespace Domain;

public interface IDomainEvent { }

public interface ICommand { }

public interface IAggregate
{
    void Apply(IDomainEvent @event);
    IReadOnlyList<IDomainEvent> Handle(ICommand command);
}
