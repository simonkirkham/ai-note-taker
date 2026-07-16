namespace Domain.Notes;

// BUG-47: thrown when an EditContent carries an ExpectedBaseContentHash that no longer matches the
// note's current content — the caller edited a stale/empty view and would silently overwrite real
// content. A terminal conflict (retrying the same stale write cannot succeed), so the API maps it to
// 409 with a distinct `stale_content` code — never the retriable 503 nor a duplicate-no-op 409.
public sealed class StaleContentEditException(NoteId noteId)
    : Exception($"Content edit for note {noteId} was based on stale content.");
