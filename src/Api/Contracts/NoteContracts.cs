namespace Api.Contracts
{
    public record CreateNoteRequest(System.Guid? NoteId);
    public record RenameNoteRequest(string Title);
    public record EditContentRequest(string Content);
}
