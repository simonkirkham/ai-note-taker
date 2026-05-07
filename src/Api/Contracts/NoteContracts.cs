namespace Api.Contracts
{
    public record CreateNoteRequest(System.Guid? NoteId);
    public record RenameNoteRequest(string Title);
    public record EditContentRequest(string Content);
    public record AddActionItemRequest(string Description, System.Guid? ActionId = null);
    public record SetNoteDateRequest(System.DateOnly? Date);
}
