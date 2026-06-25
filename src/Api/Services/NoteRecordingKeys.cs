namespace Api.Services;

// Ownership is enforced by the key namespace: a note's recording lives under
// recordings/{noteId}/ and a save request may only reference a key under that prefix.
public static class NoteRecordingKeys
{
    public static string Prefix(string noteId) => $"recordings/{noteId}/";

    public static bool IsUnderNote(string key, string noteId) =>
        !string.IsNullOrEmpty(key) && key.StartsWith(Prefix(noteId), StringComparison.Ordinal);
}
