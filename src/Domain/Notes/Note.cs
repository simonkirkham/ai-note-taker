namespace Domain.Notes;

public sealed class Note : IAggregate
{
    bool _exists;
    string? _title;
    string? _content;

    public void Apply(IDomainEvent @event)
    {
        switch (@event)
        {
            case NoteCreated:
                _exists = true;
                break;
            case NoteRenamed e:
                _title = e.NewTitle;
                break;
            case ContentEdited e:
                _content = e.NewContent;
                break;
            case ContentEditedV2 e:
                _content = e.NewContent;
                break;
        }
    }

    public IReadOnlyList<IDomainEvent> Handle(ICommand command) =>
        command switch
        {
            CreateNote cmd    => HandleCreate(cmd),
            RenameNote cmd    => HandleRename(cmd),
            EditContent cmd   => HandleEditContent(cmd),
            _ => throw new ArgumentOutOfRangeException(nameof(command))
        };

    IReadOnlyList<IDomainEvent> HandleCreate(CreateNote cmd)
    {
        if (_exists)
            throw new InvalidOperationException($"Note {cmd.NoteId} already exists.");
        return [new NoteCreated(cmd.NoteId)];
    }

    IReadOnlyList<IDomainEvent> HandleRename(RenameNote cmd)
    {
        if (!_exists)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.NewTitle == _title)
            return [];
        return [new NoteRenamed(cmd.NoteId, cmd.NewTitle)];
    }

    IReadOnlyList<IDomainEvent> HandleEditContent(EditContent cmd)
    {
        if (!_exists)
            throw new InvalidOperationException($"Note {cmd.NoteId} does not exist.");
        if (cmd.Content == _content)
            return [];
        return [new ContentEdited(cmd.NoteId, cmd.Content)];
    }
}
