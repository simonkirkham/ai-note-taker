namespace Domain.Notes;

public record ContentEditedV2(NoteId NoteId, string NewContent, int CharacterCount) : NoteEvent;
