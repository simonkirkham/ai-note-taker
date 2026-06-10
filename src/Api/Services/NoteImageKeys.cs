namespace Api.Services;

// Ownership is enforced by the key namespace: a note's images live under
// notes/{noteId}/ and a resolve request may only reference keys under that prefix.
public static class NoteImageKeys
{
    public static string Prefix(string noteId) => $"notes/{noteId}/";

    public static bool IsUnderNote(string key, string noteId) =>
        !string.IsNullOrEmpty(key) && key.StartsWith(Prefix(noteId), StringComparison.Ordinal);
}
