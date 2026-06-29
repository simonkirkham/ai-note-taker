# Phase 25-C — Note image lifecycle + analysis hygiene

Delete-note purges the note's S3 image prefix; image markdown is stripped before AI analysis. Two points worth keeping.

## 1. A best-effort cleanup that "must never fail the primary op" needs a broad catch — `AmazonS3Exception` is not enough

The S3 purge on note-delete was first wrapped in `catch (AmazonS3Exception)`. That does **not** cover the most likely runtime fault:

| Exception | Base | Caught by `AmazonS3Exception`? |
|---|---|---|
| `AmazonS3Exception` | `AmazonServiceException` | yes |
| `AmazonServiceException` (throttle, creds) | `Exception` | no |
| `AmazonClientException` (network, socket timeout, retries exhausted) | `Exception` | **no** |

A transient network timeout — the single most likely failure — would have escaped and turned a successful, already-persisted delete into a 500. For a best-effort cleanup that must never fail the authoritative operation, catch broadly and let only cancellation through:

```csharp
catch (Exception ex) when (ex is not OperationCanceledException)
{
    logger.LogWarning(ex, "Failed to purge images for deleted note {NoteId}", noteId.ToString());
}
```

`TaskCanceledException : OperationCanceledException`, so SDK-surfaced cancellation still propagates (a cancelled request aborts rather than reporting a phantom success). The broad catch is justified by the explicit "never fail the delete" contract — document the intent so it doesn't read as a swallow smell. **Test the swallow path** (fake purge throws a non-`Amazon*` exception → delete still returns 204); the happy-path test alone hides the gap.

## 2. A cross-slice S3 key prefix must match byte-for-byte

The purge prefix (`notes/{noteId}/`) must use the **same** Guid formatting 25-A used to build upload keys — hyphenated `Guid.ToString()` ("D" format), via `NoteId.ToString()` (which is `Value.ToString()`), **not** the `"N"` (no-hyphen) form. A mismatch makes the purge silently match nothing — no error, just orphaned blobs forever. When one slice writes keys and another deletes them, pin the key scheme in one shared helper (`NoteImageKeys.Prefix`) and have both call it.

## Note on the delete→purge layering

The purge is a side effect in `NoteCommandHandler`'s `NoteDeleted` branch (after projections are dropped), not a domain event — S3 bytes are external state, so no aggregate/event change. Workspace scoping (23-B) doesn't apply: the note's own `notes/{noteId}/` prefix plus the upstream ownership check already bound it.
